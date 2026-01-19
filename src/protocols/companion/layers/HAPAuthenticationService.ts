/**
 * HAP Authentication Service - Clean Implementation
 *
 * Refactored from the chaotic HapPairing class into a proper service architecture
 */

import { EventEmitter } from 'eventemitter3'
import { SrpClient } from 'fast-srp-hap'
import { type HAPFrame, HAPFrameType } from './HapFrameHandler'
import {
  ErrorCode,
  Method,
  State,
  TLV8,
  TlvBuilder,
  type TlvData,
  TlvValue,
} from '@/core/encoding/tlv8'
import { OPACK, OPACKMESSAGE } from '@/core/encoding/opack'
import { SrpUtils } from '@/core/crypto/srp'
import { Ed25519Utils } from '@/core/crypto/ed25519'
import { X25519Utils } from '@/core/crypto/x25519'
import { HkdfUtils } from '@/core/crypto/hkdf'
import { ChaCha20Utils } from '@/core/crypto/chacha20'
import type { BaseCredentials } from '@/protocols/types/BaseProtocol.ts'

import { createLogger } from '@/logging/logging'

import type { ClientDeviceInfo } from '@/core/client-identity'
import type { HapFramedChannel } from '@/protocols/companion/layers/HapFramedChannel.ts'

const logger = createLogger("bunatv:hap:auth");

export interface SessionKeys {
  writeKey: Uint8Array
  readKey: Uint8Array
}

/**
 * Session information returned after successful authentication
 */
export interface AuthenticationSession {
  /** Session keys for encryption */
  keys: SessionKeys
  /** Session identifier */
  sessionId?: string
  /** When the session was established */
  establishedAt: Date

  credentials?: HAPCredentials
}

/**
 * Callbacks for user interaction during authentication
 */
export interface AuthenticationCallbacks {
  /** Called when PIN is required (HAP pairing) */
  onPinRequired?: (deviceName?: string) => Promise<string>
}
export interface HAPCredentials extends BaseCredentials {
  identifier: string
  clientId: string
  publicKey: Uint8Array
  privateKey: Uint8Array
  accessoryPublicKey: Uint8Array
  [key: string]: unknown
}

export enum HAPAuthState {
  Idle = 'idle',
  PairingM1 = 'pairing-m1',
  PairingM2 = 'pairing-m2',
  PairingM3 = 'pairing-m3',
  PairingM4 = 'pairing-m4',
  PairingM5 = 'pairing-m5',
  PairingM6 = 'pairing-m6',
  Paired = 'paired',
  VerifyingM1 = 'verifying-m1',
  VerifyingM2 = 'verifying-m2',
  VerifyingM3 = 'verifying-m3',
  VerifyingM4 = 'verifying-m4',
  Verified = 'verified',
  Failed = 'failed',
}

interface HAPAuthConfig {
  deviceId: string // MAC address of the device being paired with
  deviceName?: string // Device Name of the device being paired with
  clientDeviceInfo: ClientDeviceInfo // Full client device identity
  timeout?: number // Operation timeout
}

interface HapAuthEvents {
  'state-changed': (newState: HAPAuthState, oldState: HAPAuthState) => void
  error: (error: Error, context: string) => void
}

export class HAPAuthenticationService extends EventEmitter<HapAuthEvents> {
  private _session?: AuthenticationSession
  private _credentials?: HAPCredentials
  private internalState: HAPAuthState = HAPAuthState.Idle

  // Flow handlers
  private pairingHandler?: PairingFlowHandler
  private verificationHandler?: VerificationFlowHandler

  // Ephemeral keypair for current operation
  private ephemeralKeyPair?: { privateKey: Uint8Array; publicKey: Uint8Array }

  // Stored credentials
  private credentials?: HAPCredentials

  private pinCallback?: () => Promise<string>

  private currentOperation?: {
    resolve: (value: any) => void
    reject: (error: Error) => void
  }

  constructor(
    private config: HAPAuthConfig,
    private readonly hapFrameChannel: HapFramedChannel
  ) {
    super()

    this.hapFrameChannel.on('frame', async frame => {
      await this.handleFrame(frame)
    })

    logger.info({ deviceId: config.deviceId }, 'HAPAuthenticationService initialized')
  }

  get state(): HAPAuthState {
    return this.internalState
  }

  get isAuthenticated(): boolean {
    return this.internalState === HAPAuthState.Verified
  }

  get session(): AuthenticationSession | undefined {
    return this._session
  }

  private setState(newState: HAPAuthState): void {
    const oldInternalState = this.internalState

    this.internalState = newState

    logger.debug({ oldState: oldInternalState, newState }, 'HAP authentication state changed')
  }

  private getActiveClientId(credentials?: HAPCredentials): string {
    // If we have credentials, ALWAYS use their clientId
    if (credentials?.clientId) {
      logger.debug({ clientId: credentials.clientId }, 'Using clientId from credentials')
      return credentials.clientId
    }

    // For pairing, resolve and cache if not already done
    return this.config.clientDeviceInfo.rpId
  }

  /**
   * Unified authentication method
   */
  async authenticate(
    credentials?: HAPCredentials,
    callbacks?: AuthenticationCallbacks
  ): Promise<AuthenticationSession> {
    logger.info(
      { hasCredentials: !!credentials, hasPinCallback: !!callbacks?.onPinRequired },
      'Starting HAP authentication'
    )
    if (credentials) {
      logger.debug('Using existing credentials for pair-verify')
      // Use existing credentials - verify them
      return this.verify(credentials)
    } else if (callbacks?.onPinRequired) {
      logger.info('No credentials found, starting pairing flow')
      // No credentials - do pairing
      const creds = await this.pair(callbacks)
      logger.debug('Pairing completed, now verifying credentials')
      return this.verify(creds)
    } else {
      logger.error('Neither credentials nor PIN callback provided')
      throw new Error('Either credentials or PIN callback required')
    }
  }

  /**
   * Pairing flow (implements optional pair method)
   */
  async pair(callbacks: AuthenticationCallbacks): Promise<HAPCredentials> {
    if (!callbacks.onPinRequired) {
      logger.error('PIN callback required for pairing but not provided')
      throw new Error('PIN callback required for pairing')
    }

    logger.info('Starting HAP pairing flow')
    // Use existing pairing logic but wrap result
    const credentials = await this.startPairingInternal(callbacks.onPinRequired)
    logger.info({ clientId: credentials.clientId }, 'HAP pairing completed successfully')
    return credentials
  }

  /**
   * Verify existing credentials
   */
  async verify(credentials: HAPCredentials): Promise<AuthenticationSession> {
    logger.info({ clientId: credentials.clientId }, 'Starting credential verification')
    const sessionKeys = await this.verifyCredentialsInternal(credentials)

    this._session = {
      keys: sessionKeys,
      establishedAt: new Date(),
      credentials,
    }

    this._credentials = credentials
    logger.info('Credential verification completed successfully')
    return this._session
  }

  /**
   * Start pairing flow
   */
  private async startPairingInternal(
    onPinRequired: () => Promise<string>
  ): Promise<HAPCredentials> {
    if (this.internalState !== HAPAuthState.Idle) {
      logger.error({ currentState: this.internalState }, 'Authentication already in progress')
      throw new Error('Authentication already in progress')
    }

    logger.debug('Initializing pairing flow')
    this.pinCallback = onPinRequired

    // Resolve client ID once for entire pairing flow
    const clientId = this.getActiveClientId()

    // Generate ephemeral keypair
    logger.trace('Generating ephemeral X25519 keypair')
    this.ephemeralKeyPair = await X25519Utils.generateKeyPair()

    // Create pairing handler with resolved client ID
    this.pairingHandler = new PairingFlowHandler(this.config, clientId, this.ephemeralKeyPair)

    // Send M1
    logger.debug('Sending pairing M1 message')
    const m1 = this.pairingHandler.createM1()
    await this.sendAuthFlowMessage(HAPFrameType.PairSetupStart, m1)

    this.setState(HAPAuthState.PairingM1)

    // Wait for pairing to complete
    return new Promise((resolve, reject) => {
      this.currentOperation = { resolve, reject }

      // Set timeout
      setTimeout(() => {
        if (this.internalState !== HAPAuthState.Paired) {
          this.currentOperation?.reject(new Error('Pairing timeout'))
          this.reset()
        }
      }, this.config.timeout || 30000)
    })
  }

  /**
   * Verify existing credentials
   */
  private async verifyCredentialsInternal(credentials: HAPCredentials): Promise<SessionKeys> {
    if (this.internalState !== HAPAuthState.Idle) {
      logger.error({ currentState: this.internalState }, 'Authentication already in progress')
      throw new Error('Authentication already in progress')
    }

    logger.debug({ clientId: credentials.clientId }, 'Initializing credential verification flow')
    this._credentials = credentials

    // Generate ephemeral keypair
    logger.trace('Generating ephemeral X25519 keypair for verification')
    this.ephemeralKeyPair = await X25519Utils.generateKeyPair()

    // Create verification handler
    this.verificationHandler = new VerificationFlowHandler(credentials, this.ephemeralKeyPair)

    // Send M1
    logger.debug('Sending pair-verify M1 message')
    const m1 = this.verificationHandler.createM1()
    await this.sendAuthFlowMessage(HAPFrameType.PairVerifyStart, m1)

    this.setState(HAPAuthState.VerifyingM1)

    // Wait for verification to complete
    return new Promise((resolve, reject) => {
      this.currentOperation = { resolve, reject }

      // Set timeout
      setTimeout(() => {
        if (this.internalState !== HAPAuthState.Verified) {
          this.currentOperation?.reject(new Error('Verification timeout'))
          this.reset()
        }
      }, this.config.timeout || 10000)
    })
  }

  /**
   * Handle incoming frame
   */
  private async handleFrame(frame: HAPFrame): Promise<void> {
    logger.trace(
      { frameType: frame.type, payloadLength: frame.payload.length },
      'Handling incoming HAP frame'
    )
    try {
      // Extract TLV8 from frame payload
      let tlvData: Buffer = frame.payload

      // Try to extract from OPACK if present
      try {
        tlvData = OPACK.extractTLV8Data(frame.payload)
        logger.trace({ tlvLength: tlvData.length }, 'Extracted TLV8 from OPACK')
      } catch {
        logger.trace('Using raw frame data as TLV8')
        // Not OPACK, use raw data
      }

      // Parse TLV8
      const tlv = TLV8.decodeObject(tlvData)

      // Check for errors
      if (tlv[TlvValue.Error]) {
        const errorCode = tlv[TlvValue.Error]![0] as ErrorCode
        logger.error({ errorCode, state: this.internalState }, 'Received HAP error in frame')
        this.handleError(errorCode)
        return
      }

      // Route based on state
      await this.routeMessage(tlv)
    } catch (error) {
      logger.error({ error, frameType: frame.type }, 'Error handling HAP frame')
      this.handleError(ErrorCode.Unknown, error as Error)
    }
  }

  /**
   * Route message based on current state
   */
  private async routeMessage(tlv: TlvData): Promise<void> {
    const seqNo = tlv[TlvValue.SeqNo]?.[0] as State | undefined

    switch (this.internalState) {
      case HAPAuthState.PairingM1:
        if (seqNo === State.M2) {
          await this.handlePairingM2(tlv)
        }
        break

      case HAPAuthState.PairingM3:
        if (seqNo === State.M4) {
          await this.handlePairingM4(tlv)
        }
        break

      case HAPAuthState.PairingM5:
        if (seqNo === State.M6) {
          await this.handlePairingM6(tlv)
        }
        break

      case HAPAuthState.VerifyingM1:
        if (seqNo === State.M2) {
          await this.handleVerifyM2(tlv)
        }
        break

      case HAPAuthState.VerifyingM3:
        if (seqNo === State.M4) {
          await this.handleVerifyM4(tlv)
        }
        break
    }
  }

  /**
   * Handle Pairing M2
   */
  private async handlePairingM2(tlv: TlvData): Promise<void> {
    if (!this.pairingHandler || !this.pinCallback) {
      logger.error('Pairing handler not initialized')
      throw new Error('Pairing handler not initialized')
    }

    logger.debug('Processing pairing M2 message')
    // Process M2
    this.pairingHandler.processM2(tlv)
    this.setState(HAPAuthState.PairingM2)

    // Get PIN from user
    logger.info('Requesting PIN from user')
    const pin = await this.pinCallback()

    // Validate PIN
    if (!/^\d{4}$/.test(pin)) {
      logger.error({ pinLength: pin.length }, 'Invalid PIN format - must be 4 digits')
      throw new Error('PIN must be 4 digits')
    }

    logger.debug('PIN received, creating M3 message')
    // Create and send M3
    const m3 = await this.pairingHandler.createM3(pin)
    await this.sendAuthFlowMessage(HAPFrameType.PairSetupNext, m3)

    this.setState(HAPAuthState.PairingM3)
  }

  /**
   * Handle Pairing M4
   */
  private async handlePairingM4(tlv: TlvData): Promise<void> {
    if (!this.pairingHandler) {
      throw new Error('Pairing handler not initialized')
    }

    this.setState(HAPAuthState.PairingM4)

    // Process M4 and get M5
    const m5 = await this.pairingHandler.processM4(tlv)
    await this.sendAuthFlowMessage(HAPFrameType.PairSetupNext, m5)

    this.setState(HAPAuthState.PairingM5)
  }

  /**
   * Handle Pairing M6
   */
  private async handlePairingM6(tlv: TlvData): Promise<void> {
    if (!this.pairingHandler) {
      logger.error('Pairing handler not initialized')
      throw new Error('Pairing handler not initialized')
    }

    logger.debug('Processing pairing M6 message')
    this.setState(HAPAuthState.PairingM6)

    // Process M6 and get credentials
    const credentials = await this.pairingHandler.processM6(tlv)
    this.credentials = credentials

    logger.info({ clientId: credentials.clientId }, 'Pairing completed successfully')
    this.setState(HAPAuthState.Paired)

    // Resolve pairing promise
    this.currentOperation?.resolve(credentials)
    this.currentOperation = undefined

    // Reset to idle state so verification can start
    this.setState(HAPAuthState.Idle)
  }

  /**
   * Handle Verify M2
   */
  private async handleVerifyM2(tlv: TlvData): Promise<void> {
    if (!this.verificationHandler) {
      throw new Error('Verification handler not initialized')
    }

    this.setState(HAPAuthState.VerifyingM2)

    // Process M2 and create M3
    const m3 = await this.verificationHandler.processM2AndCreateM3(tlv)
    await this.sendAuthFlowMessage(HAPFrameType.PairVerifyNext, m3)

    this.setState(HAPAuthState.VerifyingM3)
  }

  /**
   * Handle Verify M4
   */
  private async handleVerifyM4(tlv: TlvData): Promise<void> {
    if (!this.verificationHandler) {
      logger.error('Verification handler not initialized')
      throw new Error('Verification handler not initialized')
    }

    logger.debug('Processing pair-verify M4 message')
    this.setState(HAPAuthState.VerifyingM4)

    // Process M4 and get session keys
    const sessionKeys = this.verificationHandler.processM4(tlv)

    logger.info('Pair-verify completed successfully')
    this.setState(HAPAuthState.Verified)

    // Resolve verification promise
    this.currentOperation?.resolve(sessionKeys)
    this.currentOperation = undefined
  }

  /**
   * Send pairing message
   */
  private async sendAuthFlowMessage(frameType: HAPFrameType, payload: Buffer): Promise<void> {
    await this.hapFrameChannel.sendFrame(frameType, payload)
  }

  /**
   * Handle errors
   */
  private handleError(code: ErrorCode, error?: Error): void {
    const message = this.getErrorMessage(code)
    logger.error(
      { errorCode: code, message, underlyingError: error, state: this.internalState },
      'HAP authentication error'
    )
    this.setState(HAPAuthState.Failed)

    const fullError = new Error(error ? `${message}: ${error.message}` : message)

    this.currentOperation?.reject(fullError)
    this.currentOperation = undefined

    this.emit('error', fullError, 'HAP Authentication Service')
    this.reset()
  }

  /**
   * Get error message
   */
  private getErrorMessage(code: ErrorCode): string {
    switch (code) {
      case ErrorCode.Authentication:
        return 'Authentication failed - check PIN'
      case ErrorCode.BackOff:
        return 'Too many attempts - device is backing off'
      case ErrorCode.MaxPeers:
        return 'Device has reached maximum number of pairings'
      case ErrorCode.MaxTries:
        return 'Maximum pairing attempts reached'
      case ErrorCode.Unavailable:
        return 'Pairing is currently unavailable'
      case ErrorCode.Busy:
        return 'Device is busy with another pairing'
      default:
        return `HAP error (code: ${code})`
    }
  }

  /**
   * Reset to idle state
   */
  private reset(): void {
    logger.debug({ previousState: this.internalState }, 'Resetting HAP authentication service')
    this.internalState = HAPAuthState.Idle
    this.pairingHandler = undefined
    this.verificationHandler = undefined
    this.ephemeralKeyPair = undefined
    this.pinCallback = undefined
    this.currentOperation = undefined
    logger.trace('HAP authentication service reset completed')
  }
}

/**
 * Handles pairing flow messages (M1-M6)
 */
class PairingFlowHandler {
  private srpClient?: SrpClient
  private serverSalt?: Buffer
  private serverPublicKey?: Buffer
  private clientPublicKey?: Buffer
  private sessionKey?: Uint8Array
  private credentials?: HAPCredentials

  constructor(
    private config: Omit<HAPAuthConfig, 'clientIdProvider'>,
    private clientId: string,
    private clientKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array }
  ) {}

  /**
   * Create M1 - Start pairing
   */
  createM1(): Buffer {
    const tlv = new TlvBuilder().method(Method.PairSetup).seqNo(State.M1).build()

    return OPACKMESSAGE.createPairingMessage(tlv)
  }

  /**
   * Process M2 - Store server parameters
   */
  processM2(tlvData: TlvData): void {
    const salt = tlvData[TlvValue.Salt]
    const publicKey = tlvData[TlvValue.PublicKey]

    if (!salt || !publicKey) {
      throw new Error('M2 missing salt or public key')
    }

    this.serverSalt = Buffer.from(salt)
    this.serverPublicKey = Buffer.from(publicKey)
  }

  /**
   * Create M3 - Send client proof
   */
  async createM3(pin: string): Promise<Buffer> {
    if (!this.serverSalt || !this.serverPublicKey) {
      throw new Error('Missing M2 data')
    }

    // Create SRP client with PIN
    const secretKey = await SrpUtils.generateKey(32)
    this.srpClient = SrpUtils.createClient('Pair-Setup', pin, this.serverSalt, secretKey)

    this.srpClient.setB(this.serverPublicKey)
    this.clientPublicKey = this.srpClient.computeA()
    const clientProof = this.srpClient.computeM1()

    const tlv = new TlvBuilder()
      .method(Method.PairSetup)
      .seqNo(State.M3)
      .publicKey(this.clientPublicKey)
      .proof(clientProof)
      .build()

    return OPACKMESSAGE.createPairingMessage(tlv)
  }

  /**
   * Process M4 - Verify server proof
   */
  async processM4(tlvData: TlvData): Promise<Buffer> {
    const serverProof = tlvData[TlvValue.Proof]

    if (!serverProof || !this.srpClient) {
      throw new Error('M4 missing proof or SRP not initialized')
    }

    // Verify server proof
    this.srpClient.checkM2(serverProof)

    // Derive session key
    const srpKey = this.srpClient.computeK()

    // Create M5
    return await this.createM5(srpKey)
  }

  /**
   * Create Companion protocol additional data (tag 0x11)
   * This OPACK-encoded data is included in M5 and contains device metadata
   */
  private createCompanionAdditionalData(): Buffer {
    // Generate random 16-byte IRK (Identity Resolving Key) for Bluetooth
    const altIRK = new Uint8Array(16)
    crypto.getRandomValues(altIRK)

    if (!this.config.clientDeviceInfo) {
      throw new Error('Client device info required for Companion additional data')
    }

    // Parse MAC address from deviceId or clientDeviceInfo
    const macString = this.config.clientDeviceInfo.deviceId
    const macBytes = this.parseMacAddressToBytes(macString)

    // Get model and name from clientDeviceInfo or fall back to config
    const model = this.config.clientDeviceInfo.model
    const name = this.config.clientDeviceInfo.name

    // Build Companion-specific data structure
    const companionData = {
      accountID: this.clientId, // Same as TLV Identifier
      model: model, // Device model (e.g., "iPhone10,6")
      name: name, // Display name
      mac: macBytes, // MAC address bytes
      wifiMAC: macBytes, // WiFi MAC (can be same as mac)
      altIRK: Buffer.from(altIRK), // Alternative Identity Resolving Key
    }

    logger.debug(
      { accountID: this.clientId, model, name, macString },
      'Creating Companion additional data for M5'
    )

    // OPACK-encode the data
    return OPACK.encode(companionData)
  }

  /**
   * Parse MAC address string to 6-byte Buffer
   * Supports formats: "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF"
   */
  private parseMacAddressToBytes(macString: string): Buffer {
    // Remove separators and convert to bytes
    const cleaned = macString.replace(/[:-]/g, '')

    if (cleaned.length !== 12) {
      logger.warn(
        { macString, cleanedLength: cleaned.length },
        'Invalid MAC address length, using random MAC'
      )
      // Generate random MAC if invalid
      const randomMac = new Uint8Array(6)
      crypto.getRandomValues(randomMac)
      return Buffer.from(randomMac)
    }

    // Convert hex string to bytes
    const bytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16)
    }

    return bytes
  }

  /**
   * Create M5 - Send encrypted credentials
   */
  private async createM5(srpKey: Buffer): Promise<Buffer> {
    // Generate long-term keypair
    const ltKeyPair = await Ed25519Utils.generateKeyPair()

    // Derive keys
    const encryptionKey = await HkdfUtils.derivePairSetupKey(srpKey)
    const controllerX = await HkdfUtils.deriveControllerKey(srpKey)

    // Create signature
    const controllerInfo = Buffer.concat([
      controllerX,
      Buffer.from(this.clientId, 'utf8'),
      Buffer.from(ltKeyPair.publicKey),
    ])
    const signature = await Ed25519Utils.sign(controllerInfo, ltKeyPair.privateKey)

    // Build inner TLV with standard HAP fields + Companion additional data
    const innerTlv = TLV8.encodeObject({
      [TlvValue.Identifier]: Buffer.from(this.clientId, 'utf8'),
      [TlvValue.PublicKey]: Buffer.from(ltKeyPair.publicKey),
      [TlvValue.Signature]: Buffer.from(signature),
      [TlvValue.AdditionalData]: this.createCompanionAdditionalData(), // Tag 0x11: Companion metadata
    })

    // Encrypt
    const nonce = Buffer.concat([Buffer.alloc(4), Buffer.from('PS-Msg05')])
    const encrypted = await ChaCha20Utils.encrypt(encryptionKey, nonce.subarray(0, 12), innerTlv)

    // Store for M6
    this.sessionKey = encryptionKey
    this.credentials = {
      identifier: this.clientId,
      clientId: this.clientId,
      publicKey: ltKeyPair.publicKey,
      privateKey: ltKeyPair.privateKey,
      accessoryPublicKey: new Uint8Array(0),
    }

    const tlv = TLV8.encodeObject({
      [TlvValue.SeqNo]: Buffer.from([State.M5]),
      [TlvValue.EncryptedData]: Buffer.from(encrypted),
    })

    return OPACKMESSAGE.createPairingMessage(tlv)
  }

  /**
   * Process M6 - Extract accessory key
   */
  async processM6(tlvData: TlvData): Promise<HAPCredentials> {
    const encryptedData = tlvData[TlvValue.EncryptedData]

    if (!encryptedData || !this.sessionKey || !this.credentials) {
      throw new Error('M6 missing data or session not established')
    }

    // Decrypt
    const nonce = Buffer.concat([Buffer.alloc(4), Buffer.from('PS-Msg06')])
    const decrypted = await ChaCha20Utils.decrypt(
      this.sessionKey,
      nonce.subarray(0, 12),
      encryptedData
    )

    // Parse accessory info
    const tlv = TLV8.decodeObject(Buffer.from(decrypted))
    const accessoryPublicKey = tlv[TlvValue.PublicKey]

    if (!accessoryPublicKey) {
      throw new Error('M6 missing accessory public key')
    }

    // Update credentials
    this.credentials.accessoryPublicKey = new Uint8Array(accessoryPublicKey)

    return this.credentials
  }

  get needsPin(): boolean {
    return this.serverSalt !== undefined && this.serverPublicKey !== undefined
  }
}
/**
 * Handles verification flow messages (M1-M4)
 */
class VerificationFlowHandler {
  private sharedSecret?: Uint8Array
  private sessionKeys?: SessionKeys

  constructor(
    private credentials: HAPCredentials,
    private clientKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array }
  ) {}

  /**
   * Create M1 - Start verification
   */
  createM1(): Buffer {
    const tlv = new TlvBuilder()
      .method(Method.PairVerify)
      .seqNo(State.M1)
      .publicKey(this.clientKeyPair.publicKey)
      .build()

    return OPACKMESSAGE.createVerifyMessage(tlv)
  }

  /**
   * Process M2 and create M3
   */
  async processM2AndCreateM3(tlvData: TlvData): Promise<Buffer> {
    const accessoryPublicKey = tlvData[TlvValue.PublicKey]
    const encryptedData = tlvData[TlvValue.EncryptedData]

    if (!accessoryPublicKey || !encryptedData) {
      throw new Error('Verify M2 missing required fields')
    }

    // Compute shared secret
    this.sharedSecret = await X25519Utils.computeSharedSecret(
      this.clientKeyPair.privateKey,
      accessoryPublicKey
    )

    // Derive verify key
    const verifyKey = await HkdfUtils.derive(
      this.sharedSecret,
      Buffer.from('Pair-Verify-Encrypt-Salt'),
      Buffer.from('Pair-Verify-Encrypt-Info'),
      32
    )

    // Decrypt accessory data
    const nonce = Buffer.concat([Buffer.alloc(4), Buffer.from('PV-Msg02')])
    const decrypted = await ChaCha20Utils.decrypt(verifyKey, nonce.subarray(0, 12), encryptedData)

    // Verify signature
    const tlv = TLV8.decodeObject(Buffer.from(decrypted))
    const accessoryId = tlv[TlvValue.Identifier]
    const accessorySignature = tlv[TlvValue.Signature]

    if (!accessoryId || !accessorySignature) {
      throw new Error('Verify M2 missing accessory credentials')
    }

    const accessoryInfo = Buffer.concat([
      accessoryPublicKey,
      accessoryId,
      Buffer.from(this.clientKeyPair.publicKey),
    ])

    const valid = await Ed25519Utils.verify(
      accessorySignature,
      accessoryInfo,
      this.credentials.accessoryPublicKey
    )

    if (!valid) {
      throw new Error('Accessory signature verification failed')
    }

    // Create our signature
    const controllerInfo = Buffer.concat([
      Buffer.from(this.clientKeyPair.publicKey),
      Buffer.from(this.credentials.identifier, 'utf8'),
      accessoryPublicKey,
    ])

    const signature = await Ed25519Utils.sign(controllerInfo, this.credentials.privateKey)

    // Build M3 response
    const m3Payload = new TlvBuilder()
      .identifier(this.credentials.identifier)
      .add(TlvValue.Signature, signature)
      .build()

    // Encrypt M3
    const m3Nonce = Buffer.concat([Buffer.alloc(4), Buffer.from('PV-Msg03')])
    const encrypted = await ChaCha20Utils.encrypt(verifyKey, m3Nonce.subarray(0, 12), m3Payload)

    // Derive Companion protocol session keys
    // IMPORTANT: Companion uses different HKDF parameters than standard HAP
    // Salt: empty string, Info: "ClientEncrypt-main"/"ServerEncrypt-main"
    logger.info('About to derive Companion session keys from shared secret')
    this.sessionKeys = HkdfUtils.deriveCompanionSessionKeysSync(this.sharedSecret)
    logger.info(
      {
        writeKeyLength: this.sessionKeys.writeKey.length,
        readKeyLength: this.sessionKeys.readKey.length,
      },
      'Companion session keys derived successfully'
    )

    const tlvResponse = new TlvBuilder()
      .method(Method.PairVerify)
      .seqNo(State.M3)
      .encryptedData(encrypted)
      .build()

    return OPACKMESSAGE.createVerifyMessage(tlvResponse)
  }

  /**
   * Process M4 - Verification complete
   */
  processM4(_tlvData: TlvData): SessionKeys {
    if (!this.sessionKeys) {
      throw new Error('Session keys not derived')
    }

    return this.sessionKeys
  }
}
