import { EventEmitter } from 'eventemitter3'
import {
  type CredentialStore,
  type Protocol,
  type ProtocolEvents,
  ProtocolState,
} from '@/protocols/types/BaseProtocol.ts'
import { ProtocolStateMachine } from '@/core/utils/ProtocolStateMachine.ts'
import { RecoveryManager } from '@/core/utils/RecoveryManager.ts'
import type { AppleDevice } from '@/core/discovery/discovery-types.ts'
import type { ClientDeviceInfo } from '@/core/client-identity.ts'
import { BunTCPTransport } from '@/protocols/shared/layers/BunTCPTransport.ts'
import { ChaCha20EncryptionLayer } from '@/protocols/shared/layers/ChaCha20EncryptionLayer.ts'
import { HttpFramedChannel } from './HttpFramedChannel.ts'
import { AirPlayAuthClient, type AirPlayCredentials } from './AirPlayAuthenticationService.ts'
import {
  type DataStreamConfig,
  type RemoteControlSetupInfo,
  RtspSession,
} from '@/protocols/rtsp/RtspSession.ts'
import type { Storage } from '@/core/storage/types.ts'
import { createLogger } from '@/logging/logging.ts'
import { DataStreamChannel } from '@/protocols/airplay/layers/DataStreamChannel.ts'
import { HkdfUtils } from '@/core/crypto/hkdf.ts'
import { NonceFormat } from '@/core/encoding/buffer-utils.ts'
import { EventStreamChannel } from '@/protocols/airplay/layers/EventStreamChannel.ts'
import { ProtocolMessage } from '@/protocols/mrp/generated/ProtocolMessage.ts'
import { deviceInfoMessage } from '@/protocols/mrp/generated/DeviceInfoMessage.ts'
import { EmitterEx } from '@/core/eventing/EmitterEx.ts'

const logger = createLogger('bunatv:airplay:session')

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface Airplay2SessionEvents extends ProtocolEvents {
  /** Raw data received on the data channel */
  'data-received': (data: Buffer) => void
  /** Event received on the event channel */
  'event-received': (data: Buffer) => void
}

export interface Airplay2SessionOptions {
  /** Callback for PIN entry during pairing */
  onPinRequired?: () => Promise<string>
}

export interface Airplay2SessionInfo {
  eventPort: number
  dataPort: number
  streamId?: number
}

// ============================================================================
// Airplay2Session Implementation
// ============================================================================

const DEFAULT_AIRPLAY_PORT = 7000
const KEEP_ALIVE_INTERVAL_MS = 2000

export class Airplay2Session
  extends EmitterEx<Airplay2SessionEvents>
  implements Protocol<Airplay2SessionEvents>
{
  // State management
  private readonly stateMachine = new ProtocolStateMachine()
  private readonly recoveryManager = new RecoveryManager()

  // Core protocol layers
  private readonly transport = new BunTCPTransport()
  private readonly encryption = new ChaCha20EncryptionLayer({ format: NonceFormat.Hap })
  private readonly channel: HttpFramedChannel
  private readonly authClient: AirPlayAuthClient
  private readonly rtsp: RtspSession

  // Secondary channels (for event and data streams)
  private eventChannel?: EventStreamChannel
  dataChannel?: DataStreamChannel

  // Keep-alive
  private keepAliveInterval?: ReturnType<typeof setInterval>

  // Credentials
  private readonly credentialStore: CredentialStore<AirPlayCredentials>

  // Connection info
  private readonly connectionInfo: { address: string; port: number }
  private sessionInfo?: Airplay2SessionInfo

  // ============================================================================
  // Factory & Constructor
  // ============================================================================
  private sharedSecret: Uint8Array<ArrayBufferLike> | undefined

  static async create(device: AppleDevice, storage: Storage): Promise<Airplay2Session> {
    const clientDeviceInfo = await storage.getClientDeviceInfo()
    return new Airplay2Session(device, storage, clientDeviceInfo)
  }

  private constructor(
    private readonly device: AppleDevice,
    private readonly storage: Storage,
    private readonly clientDeviceInfo: ClientDeviceInfo
  ) {
    super()

    if (!device.address) {
      throw new Error('Device must have a valid address')
    }

    this.connectionInfo = {
      address: device.address,
      port: device.services?.airPlay?.port ?? DEFAULT_AIRPLAY_PORT,
    }

    this.credentialStore = this.storage.getCredentialStore<AirPlayCredentials>(
      device.identifier,
      'airplay'
    )

    // Initialize layers
    this.channel = new HttpFramedChannel(this.transport, this.encryption)
    this.authClient = new AirPlayAuthClient(this.channel)
    this.rtsp = new RtspSession(this.channel)

    this.setupEventHandlers()
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private setupEventHandlers(): void {
    this.stateMachine.on('state-changed', (newState, oldState) => {
      this.emit('state-changed', newState, oldState)
      if (newState === ProtocolState.Ready) {
        this.emit('ready')
      }
    })

    this.transport.on('error', error => {
      this.emit('error', error, 'transport')
    })
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return

    this.dataChannel.on('protobuf', data => {
      logger.trace({ length: data.length }, 'Data channel data received')
      const message = ProtocolMessage.decode(data)
      const deviceInfo = ProtocolMessage.getExtension(message, deviceInfoMessage)

      logger.trace({ message, deviceInfo }, 'Decoded ProtocolMessage from data channel')
      this.emit('data-received', data)
    })
  }

  // ============================================================================
  // Public API
  // ============================================================================

  get state(): ProtocolState {
    return this.stateMachine.state
  }

  get isReady(): boolean {
    return this.stateMachine.isReady
  }

  get session(): Airplay2SessionInfo | undefined {
    return this.sessionInfo
  }

  /**
   * Connect to the AirPlay device and establish a remote control session
   */
  async connect(options?: Airplay2SessionOptions): Promise<void> {
    try {
      await this.recoveryManager.runWithRecovery(() => this._connect(options), {
        maxAttempts: 3,
        delay: 300,
      })
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)), 'connect')
      logger.error({ error }, 'Failed to connect after recovery attempts')
      throw error
    }
  }

  /**
   * Disconnect from the AirPlay device
   */
  async disconnect(reason?: string): Promise<void> {
    if (this.state === ProtocolState.Idle || this.state === ProtocolState.Disconnecting) {
      logger.debug(
        { currentState: this.state },
        'Already idle or disconnecting, ignoring disconnect request'
      )
      return
    }

    this.stateMachine.setState(ProtocolState.Disconnecting)

    // Stop keep-alive
    this.stopKeepAlive()

    // Teardown RTSP session
    try {
      await this.rtsp.teardown()
    } catch (error) {
      logger.warn({ error }, 'Failed to teardown RTSP session')
    }

    // Disconnect secondary channels
    if (this.dataChannel) {
      await this.dataChannel.disconnect()
      this.dataChannel = undefined
    }

    if (this.eventChannel) {
      await this.eventChannel.disconnect()
      this.eventChannel = undefined
    }

    // Disable encryption
    this.encryption.disable()

    // Disconnect main transport
    await this.transport.disconnect(reason)

    this.sessionInfo = undefined
    this.stateMachine.setState(ProtocolState.Idle)
    this.emit('disconnected', reason)
  }

  /**
   * Start the keep-alive loop
   */
  startKeepAlive(): void {
    if (this.keepAliveInterval) {
      return
    }

    logger.debug('Starting keep-alive loop')
    this.keepAliveInterval = setInterval(async () => {
      try {
        await this.rtsp.feedback()
        logger.trace('Keep-alive sent')
      } catch (error) {
        logger.warn({ error }, 'Keep-alive failed')
        this.emit('error', error instanceof Error ? error : new Error(String(error)), 'keep-alive')
      }
    }, KEEP_ALIVE_INTERVAL_MS)
  }

  /**
   * Stop the keep-alive loop
   */
  stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = undefined
      logger.debug('Keep-alive stopped')
    }
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  private async _connect(options?: Airplay2SessionOptions): Promise<void> {
    this.stateMachine.assertState(ProtocolState.Idle, 'connect')

    // Step 1: Connect transport
    this.emit('connecting')
    this.stateMachine.setState(ProtocolState.Connecting)
    logger.info(
      { address: this.connectionInfo.address, port: this.connectionInfo.port },
      'Connecting to AirPlay device'
    )

    await this.transport.connect(this.connectionInfo.address, this.connectionInfo.port, {
      timeout: 10000,
    })
    logger.debug('Transport connected')

    // Step 2: Authenticate
    this.stateMachine.setState(ProtocolState.Authenticating)
    let credentials = await this.credentialStore.load(this.device.identifier)

    const authResult = await this.authClient.authenticate(credentials, {
      onPinRequired: options?.onPinRequired,
    })

    if (authResult.credentials && !credentials) {
      // Save new credentials
      await this.credentialStore.save(this.device.identifier, authResult.credentials)
      credentials = authResult.credentials
    }

    this.sharedSecret = authResult.sharedSecret
    // Step 3: Enable encryption with derived keys
    logger.debug('Enabling encryption')
    this.encryption.enable(authResult.keys)
    this.emit('connected')

    // Step 4: Setup RTSP session
    this.stateMachine.setState(ProtocolState.EstablishingSession)
    await this.setupRtspSession()

    // Step 5: Ready
    this.stateMachine.setState(ProtocolState.Ready)
    logger.info('AirPlay session ready')
  }

  private async setupRtspSession(): Promise<void> {
    if (!this.sharedSecret) {
      throw new Error('Shared secret is not available for RTSP session setup')
    }

    // // AirPlay 2 auth-setup (required before SETUP)
    // logger.debug('Performing auth-setup')
    // await this.rtsp.authSetup()

    // Setup remote control - returns eventPort
    const setupInfo = this.buildRemoteControlSetupInfo()
    logger.debug({ setupInfo }, 'Setting up remote control')

    const rcResult = await this.rtsp.setupRemoteControl(setupInfo)
    if (!rcResult.eventPort) {
      throw new Error('Remote control setup did not return eventPort')
    }
    logger.debug({ eventPort: rcResult.eventPort }, 'Remote control setup complete')

    logger.debug('Event channel connected')

    const eventEncryptionLayer = new ChaCha20EncryptionLayer({ format: NonceFormat.Hap })
    const eventDataKeys = HkdfUtils.deriveAirPlayEventKeysSync(this.sharedSecret)
    eventEncryptionLayer.enable({
      readKey: eventDataKeys.readKey,
      writeKey: eventDataKeys.writeKey,
    })

    logger.debug('Event channel connecting')

    this.eventChannel = new EventStreamChannel(
      { address: this.connectionInfo.address, port: rcResult.eventPort },
      eventEncryptionLayer
    )
    await this.eventChannel.start()

    logger.debug('Starting RTSP session setup')
    // Send RECORD to start session
    await this.rtsp.record()
    logger.debug('RTSP RECORD sent')

    // Setup data stream - returns dataPort
    const streamConfig = this.buildDataStreamConfig()
    const dsResult = await this.rtsp.setupDataStream(streamConfig)
    if (!dsResult.dataPort) {
      throw new Error('Data stream setup did not return dataPort')
    }
    logger.debug(
      { dataPort: dsResult.dataPort, streamId: dsResult.streamId },
      'Data stream setup complete'
    )

    // Connect data channel

    const encryptionLayer = new ChaCha20EncryptionLayer({ format: NonceFormat.Hap })
    const dataKeys = HkdfUtils.deriveAirPlayDataStreamKeysSync(this.sharedSecret, streamConfig.seed)
    encryptionLayer.enable(dataKeys)
    this.dataChannel = new DataStreamChannel(
      { address: this.connectionInfo.address, port: dsResult.dataPort },
      encryptionLayer
    )
    await this.dataChannel.connect()
    this.setupDataChannel()
    logger.debug('Data channel connected')

    // Store session info
    this.sessionInfo = {
      eventPort: rcResult.eventPort,
      dataPort: dsResult.dataPort,
      streamId: dsResult.streamId,
    }

    // Start keep-alive
    this.startKeepAlive()
  }

  private buildRemoteControlSetupInfo(): RemoteControlSetupInfo {
    return {
      osName: this.clientDeviceInfo.osName,
      sourceVersion: this.clientDeviceInfo.sourceVersion,
      timingProtocol: 'None',
      model: this.clientDeviceInfo.model,
      deviceId: this.clientDeviceInfo.deviceId,
      osVersion: this.clientDeviceInfo.osVersion,
      osBuildVersion: this.clientDeviceInfo.osBuild,
      macAddress: this.clientDeviceInfo.mac,
      sessionUuid: crypto.randomUUID().toUpperCase(),
      name: this.clientDeviceInfo.name,
    }
  }

  private buildDataStreamConfig(): DataStreamConfig {
    return {
      channelId: crypto.randomUUID().toUpperCase(),
      seed: BigInt(Math.floor(Math.random() * 2 ** 32)),
      clientUuid: crypto.randomUUID().toUpperCase(),
    }
  }

  private generateMacAddress(): string {
    // Generate a random MAC address with locally administered bit set
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    bytes[0] = (bytes[0]! | 0x02) & 0xfe // Set locally administered, clear multicast
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(':')
  }
}
