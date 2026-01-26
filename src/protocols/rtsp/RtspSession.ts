import type { HttpFramedChannel, HttpResponse } from '../airplay/layers/HttpFramedChannel.ts'
import { createLogger } from '@/logging/logging.ts'
import { Plist } from '@/core/encoding/plist.ts'
import type { InfoMessage } from '@/protocols/rtsp/messages/info.ts'

const logger = createLogger('bunatv:airplay:rtsp')

export interface RtspSetupResponse {
  eventPort?: number
  dataPort?: number
  streamId?: number
  timingPort?: number
}

export class RtspSession {
  private cseq = 0
  private sessionUrl = '*'
  private sessionId?: string

  constructor(
    private readonly channel: HttpFramedChannel,
    private readonly userAgent = 'AirPlay/550.10'
  ) {}

  initSession(host: string): void {
    this.sessionId = BigInt(Math.floor(Math.random() * 2 ** 63)).toString()
    this.sessionUrl = `rtsp://${host}/${this.sessionId}`
    logger.debug({ sessionUrl: this.sessionUrl }, 'Initialized RTSP session')
  }

  private async request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: Buffer
  ): Promise<HttpResponse> {
    this.cseq++
    const response = await this.channel.sendRequest(
      method,
      path,
      {
        CSeq: String(this.cseq),
        'User-Agent': this.userAgent,
        ...headers,
      },
      body,
      'RTSP/1.0'
    )

    // Validate CSeq matches
    const responseCseq = response.headers.get('cseq')

    if (responseCseq && parseInt(responseCseq, 10) !== this.cseq) {
      logger.warn({ expected: this.cseq, got: responseCseq }, 'CSeq mismatch')
    }

    if (response.statusCode !== 200) {
      throw new Error(`RTSP ${method} failed: ${response.statusCode} ${response.statusText}`)
    }

    return response
  }

  async options(): Promise<string[]> {
    const response = await this.request('OPTIONS', '*')
    const publicHeader = response.headers.get('public') || ''
    return publicHeader.split(',').map(m => m.trim())
  }

  async getInfo(): Promise<InfoMessage> {
    const response = await this.channel.get('/info')
    const message = Plist.decode(response.body)
    return message as unknown as InfoMessage
  }

  /**
   * AirPlay 2 auth-setup - sends static Curve25519 public key
   * Required before RTSP SETUP for AirPlay 2 devices
   */
  async authSetup(): Promise<void> {
    // Static Curve25519 public key used by pyatv and other AirPlay implementations
    // This is a well-known test key that AirPlay devices accept
    const publicKey = Buffer.from([
      0x59, 0x02, 0xed, 0xe9, 0x0d, 0x4e, 0xf2, 0xbd, 0x4c, 0xb6, 0x8a, 0x63,
      0x30, 0x03, 0x82, 0x07, 0xa9, 0x4d, 0xbd, 0x50, 0xd8, 0xaa, 0x46, 0x5b,
      0x5d, 0x8c, 0x01, 0x2a, 0x0c, 0x7e, 0x1d, 0x4e,
    ])

    // Auth setup payload: 1 byte type (1 = Curve25519) + 32 bytes public key
    const payload = Buffer.concat([Buffer.from([0x01]), publicKey])

    logger.debug('Sending auth-setup request')

    const response = await this.channel.post('/auth-setup', payload, {
      'Content-Type': 'application/octet-stream',
    })

    if (response.statusCode !== 200) {
      throw new Error(`Auth setup failed: ${response.statusCode} ${response.statusText}`)
    }

    logger.debug('Auth setup completed')
  }

  async setupRemoteControl(setupInfo: RemoteControlSetupInfo): Promise<RtspSetupResponse> {
    const body = Buffer.from(
      Plist.encode({
        isRemoteControlOnly: true,
        osName: setupInfo.osName,
        sourceVersion: setupInfo.sourceVersion,
        timingProtocol: 'None',
        model: setupInfo.model,
        deviceID: setupInfo.deviceId,
        osVersion: setupInfo.osVersion,
        osBuildVersion: setupInfo.osBuildVersion,
        macAddress: setupInfo.macAddress,
        sessionUUID: setupInfo.sessionUuid,
        name: setupInfo.name,
        isMultiSelectAirPlay: false,
        groupContainsGroupLeader: false,
        senderSupportsRelay: false,
        statsCollectionEnabled: false,
      })
    )

    logger.debug({ sessionUrl: this.sessionUrl }, 'Setting up remote control')

    const response = await this.request(
      'SETUP',
      this.sessionUrl,
      { 'Content-Type': 'application/x-apple-binary-plist' },
      body
    )

    const parsed = Plist.decode(response.body) as Record<string, unknown>

    logger.debug({ parsed }, 'Remote control setup response')

    return {
      eventPort: parsed.eventPort as number | undefined,
      timingPort: parsed.timingPort as number | undefined,
    }
  }

  async record(): Promise<void> {
    await this.request('RECORD', this.sessionUrl)
  }

  async setupDataStream(config: DataStreamConfig): Promise<RtspSetupResponse> {
    const body = Buffer.from(
      Plist.encode({
        streams: [
          {
            controlType: 2,
            channelID: config.channelId,
            seed: Number(config.seed),
            clientUUID: config.clientUuid,
            type: 130, // Remote Control
            wantsDedicatedSocket: true,
            clientTypeUUID: '1910A70F-DBC0-4242-AF95-115DB30604E1', // Media Remote
          },
        ],
      })
    )

    logger.debug({ sessionUrl: this.sessionUrl }, 'Setting up data stream')

    const response = await this.request(
      'SETUP',
      this.sessionUrl,
      { 'Content-Type': 'application/x-apple-binary-plist' },
      body
    )

    const parsed = Plist.decode(response.body) as Record<string, unknown>
    const streams = parsed.streams as Array<Record<string, unknown>> | undefined
    const stream = streams?.[0]

    logger.debug({ parsed, stream }, 'Data stream setup response')

    return {
      dataPort: stream?.dataPort as number | undefined,
      streamId: stream?.streamID as number | undefined,
    }
  }

  async setVolume(volume: number): Promise<void> {
    const body = Buffer.from(`volume: ${volume.toFixed(6)}\n`, 'utf-8')
    await this.request(
      'SET_PARAMETER',
      this.sessionUrl,
      { 'Content-Type': 'text/parameters' },
      body
    )
  }

  async feedback(): Promise<void> {
    await this.channel.post('/feedback', undefined, {
      CSeq: String(++this.cseq),
      'User-Agent': this.userAgent,
    })
  }

  async teardown(): Promise<void> {
    await this.request('TEARDOWN', this.sessionUrl)
  }

  get currentSessionUrl(): string {
    return this.sessionUrl
  }
}

// Types
export interface RemoteControlSetupInfo {
  osName: string
  timingProtocol: string
  sourceVersion: string
  model: string
  deviceId: string
  osVersion: string
  osBuildVersion: string
  macAddress: string
  sessionUuid: string
  name: string
}

export interface DataStreamConfig {
  channelId: string
  seed: bigint
  clientUuid: string
}
