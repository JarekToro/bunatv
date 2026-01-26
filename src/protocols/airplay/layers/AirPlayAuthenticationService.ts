import { EventEmitter } from 'eventemitter3'
import { SrpClient } from 'fast-srp-hap'
import {
  TLV8,
  TlvBuilder,
  type TlvData,
  TlvValue,
  State,
  Method,
  ErrorCode,
} from '@/core/encoding/tlv8'
import { SrpUtils } from '@/core/crypto/srp'
import { Ed25519Utils } from '@/core/crypto/ed25519'
import { X25519Utils } from '@/core/crypto/x25519'
import { HkdfUtils } from '@/core/crypto/hkdf'
import { ChaCha20Utils } from '@/core/crypto/chacha20'
import type { HttpFramedChannel, HttpResponse } from './HttpFramedChannel'
import { createLogger } from '@/logging/logging'
import { generateClientId } from '@/core/client-identity.ts'

const logger = createLogger('bunatv:airplay:auth')

export interface AirPlayCredentials {
  identifier: string
  publicKey: Uint8Array
  privateKey: Uint8Array
  serverPublicKey: Uint8Array
  [key: string]: unknown
}


export interface AirPlayAuthCallbacks {
  onPinRequired?: () => Promise<string>
}

export enum AirPlayAuthState {
  Idle = 'idle',
  PairingM1 = 'pairing-m1',
  PairingM2 = 'pairing-m2',
  PairingM3 = 'pairing-m3',
  PairingM4 = 'pairing-m4',
  PairingM5 = 'pairing-m5',
  PairingM6 = 'pairing-m6',
  Paired = 'paired',
  VerifyV1 = 'verify-v1',
  VerifyV2 = 'verify-v2',
  VerifyV3 = 'verify-v3',
  VerifyV4 = 'verify-v4',
  Verified = 'verified',
  Failed = 'failed',
}

interface AirPlayAuthEvents {
  'state-changed': (newState: AirPlayAuthState, oldState: AirPlayAuthState) => void
  error: (error: Error) => void
}

/**
 * AirPlay Authentication Client
 *
 * Key differences from Companion HAPAuthenticationService:
 * - Uses HTTP POST to /pair-setup and /pair-verify (not HAP frames)
 * - TLV8 sent directly in HTTP body (not wrapped in OPACK)
 * - Different HKDF salt/info for session keys
 * - Synchronous request/response (not event-driven frames)
 */
export class AirPlayAuthClient extends EventEmitter<AirPlayAuthEvents> {
  private state: AirPlayAuthState = AirPlayAuthState.Idle

  constructor(
    private readonly channel: HttpFramedChannel
  ) {
    super()
  }

  private setState(newState: AirPlayAuthState): void {
    const oldState = this.state
    this.state = newState
    logger.debug({ oldState, newState }, 'AirPlay auth state changed')
    this.emit('state-changed', newState, oldState)
  }

  /**
   * Main authentication entry point
   */
  async authenticate(
    credentials?: AirPlayCredentials,
    callbacks?: AirPlayAuthCallbacks
  ) {
    if (credentials) {
      logger.info('Verifying existing AirPlay credentials')
      const { keys, sharedSecret } = await this.verify(credentials)
      return { keys, credentials, sharedSecret }
    }

    if (!callbacks?.onPinRequired) {
      throw new Error('Either credentials or PIN callback required')
    }

    logger.info('Starting AirPlay pairing flow')
    const newCredentials = await this.pair(callbacks, generateClientId())

    logger.info('Pairing complete, verifying new credentials')
    const {keys, sharedSecret} = await this.verify(newCredentials)
    return { keys, credentials: newCredentials, sharedSecret }
  }

  /**
   * Pair-Setup flow (M1-M6) - requires PIN
   */
  async pair(callbacks: AirPlayAuthCallbacks, clientId: string): Promise<AirPlayCredentials> {
    if (!callbacks.onPinRequired) {
      throw new Error('PIN callback required for pairing')
    }

    const handler = new AirPlayPairingHandler(clientId)

    try {
      // Trigger PIN display on Apple TV
      logger.debug('Triggering PIN display on device')
      await this.channel.post('/pair-pin-start')

      // M1: Start pairing
      this.setState(AirPlayAuthState.PairingM1)
      const m1 = handler.createM1()
      const m2Response = await this.sendPairSetup(m1)

      // M2: Process server salt + public key
      this.setState(AirPlayAuthState.PairingM2)
      const m2Tlv = this.parseTlvResponse(m2Response)
      handler.processM2(m2Tlv)

      // Get PIN from user
      logger.info('Requesting PIN from user')
      const pin = await callbacks.onPinRequired()
      this.validatePin(pin)

      // M3: Send client public key + proof
      this.setState(AirPlayAuthState.PairingM3)
      const m3 = await handler.createM3(pin)
      const m4Response = await this.sendPairSetup(m3)

      // M4: Verify server proof
      this.setState(AirPlayAuthState.PairingM4)
      const m4Tlv = this.parseTlvResponse(m4Response)
      const m5 = await handler.processM4AndCreateM5(m4Tlv)

      // M5: Send encrypted credentials
      this.setState(AirPlayAuthState.PairingM5)
      const m6Response = await this.sendPairSetup(m5)

      // M6: Extract server credentials
      this.setState(AirPlayAuthState.PairingM6)
      const m6Tlv = this.parseTlvResponse(m6Response)
      const credentials = await handler.processM6(m6Tlv)

      this.setState(AirPlayAuthState.Paired)
      logger.info('AirPlay pairing completed successfully')

      return credentials
    } catch (error) {
      this.setState(AirPlayAuthState.Failed)
      throw error
    }
  }

  /**
   * Pair-Verify flow (V1-V4) - uses stored credentials
   */
  async verify(credentials: AirPlayCredentials) {
    const handler = new AirPlayVerifyHandler(credentials)

    try {
      // V1: Send session public key
      this.setState(AirPlayAuthState.VerifyV1)
      const v1 = handler.createV1()
      const v2Response = await this.sendPairVerify(v1)

      // V2: Process server session key + encrypted data
      this.setState(AirPlayAuthState.VerifyV2)
      const v2Tlv = this.parseTlvResponse(v2Response)
      const v3 = await handler.processV2AndCreateV3(v2Tlv)

      // V3: Send encrypted verification
      this.setState(AirPlayAuthState.VerifyV3)
      const v4Response = await this.sendPairVerify(v3)

      // V4: Verification complete
      this.setState(AirPlayAuthState.VerifyV4)
      const v4Tlv = this.parseTlvResponse(v4Response)
      const keys = handler.processV4(v4Tlv)

      this.setState(AirPlayAuthState.Verified)
      logger.info('AirPlay verification completed successfully')

      return { keys, sharedSecret: handler.sharedSecret }
    } catch (error) {
      this.setState(AirPlayAuthState.Failed)
      throw error
    }
  }

  private async sendPairSetup(tlv: Buffer): Promise<HttpResponse> {
    const response = await this.channel.post('/pair-setup', tlv, {
      'Content-Type': 'application/octet-stream',
      'X-Apple-HKP': '3',
    })

    if (response.statusCode !== 200) {
      throw new Error(`Pair-setup failed: ${response.statusCode} ${response.statusText}`)
    }

    return response
  }

  private async sendPairVerify(tlv: Buffer): Promise<HttpResponse> {
    const response = await this.channel.post('/pair-verify', tlv, {
      'Content-Type': 'application/octet-stream',
      'X-Apple-HKP': '3',
    })

    if (response.statusCode !== 200) {
      throw new Error(`Pair-verify failed: ${response.statusCode} ${response.statusText}`)
    }

    return response
  }

  private parseTlvResponse(response: HttpResponse): TlvData {
    const tlv = TLV8.decodeObject(response.body)

    // Check for errors
    if (tlv[TlvValue.Error]) {
      const errorCode = tlv[TlvValue.Error]![0] as ErrorCode
      throw new Error(this.getErrorMessage(errorCode))
    }

    return tlv
  }

  private validatePin(pin: string): void {
    if (!/^\d{4}$/.test(pin)) {
      throw new Error('PIN must be 4 digits')
    }
  }

  private getErrorMessage(code: ErrorCode): string {
    switch (code) {
      case ErrorCode.Authentication:
        return 'Authentication failed - check PIN'
      case ErrorCode.BackOff:
        return 'Too many attempts - try again later'
      case ErrorCode.MaxPeers:
        return 'Maximum pairings reached'
      case ErrorCode.MaxTries:
        return 'Maximum attempts reached'
      case ErrorCode.Unavailable:
        return 'Pairing unavailable'
      case ErrorCode.Busy:
        return 'Device busy'
      default:
        return `HAP error: ${code}`
    }
  }
}

/**
 * Handles Pair-Setup M1-M6
 * (Nearly identical to Companion PairingFlowHandler, minus OPACK wrapping)
 */
class AirPlayPairingHandler {
  private srpClient?: SrpClient
  private serverSalt?: Buffer
  private serverPublicKey?: Buffer
  private sessionKey?: Uint8Array
  private credentials?: AirPlayCredentials

  constructor(private readonly clientId: string) {}

  createM1(): Buffer {
    // AirPlay: TLV8 directly, no OPACK wrapper
    return TLV8.encodeObject({
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M1]),
    })
  }

  processM2(tlv: TlvData): void {
    const salt = tlv[TlvValue.Salt]
    const publicKey = tlv[TlvValue.PublicKey]

    if (!salt || !publicKey) {
      throw new Error('M2 missing salt or public key')
    }

    this.serverSalt = Buffer.from(salt)
    this.serverPublicKey = Buffer.from(publicKey)
  }

  async createM3(pin: string): Promise<Buffer> {
    if (!this.serverSalt || !this.serverPublicKey) {
      throw new Error('M2 not processed')
    }

    const secretKey = await SrpUtils.generateKey(32)
    this.srpClient = SrpUtils.createClient('Pair-Setup', pin, this.serverSalt, secretKey)

    this.srpClient.setB(this.serverPublicKey)
    const clientPublicKey = this.srpClient.computeA()
    const clientProof = this.srpClient.computeM1()

    return TLV8.encodeObject({
      [TlvValue.SeqNo]: Buffer.from([State.M3]),
      [TlvValue.PublicKey]: clientPublicKey,
      [TlvValue.Proof]: clientProof,
    })
  }

  async processM4AndCreateM5(tlv: TlvData): Promise<Buffer> {
    const serverProof = tlv[TlvValue.Proof]

    if (!serverProof || !this.srpClient) {
      throw new Error('M4 missing proof')
    }

    this.srpClient.checkM2(serverProof)
    const srpKey = this.srpClient.computeK()

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

    // Build inner TLV (AirPlay doesn't need Companion additional data)
    const innerTlv = TLV8.encodeObject({
      [TlvValue.Identifier]: Buffer.from(this.clientId, 'utf8'),
      [TlvValue.PublicKey]: Buffer.from(ltKeyPair.publicKey),
      [TlvValue.Signature]: Buffer.from(signature),
    })

    // Encrypt
    const nonce = Buffer.alloc(12)
    nonce.write('PS-Msg05', 4)
    const encrypted = await ChaCha20Utils.encrypt(encryptionKey, nonce, innerTlv)

    this.sessionKey = encryptionKey
    this.credentials = {
      identifier: this.clientId,
      publicKey: ltKeyPair.publicKey,
      privateKey: ltKeyPair.privateKey,
      serverPublicKey: new Uint8Array(0),
    }

    return TLV8.encodeObject({
      [TlvValue.SeqNo]: Buffer.from([State.M5]),
      [TlvValue.EncryptedData]: Buffer.from(encrypted),
    })
  }

  async processM6(tlv: TlvData): Promise<AirPlayCredentials> {
    const encryptedData = tlv[TlvValue.EncryptedData]

    if (!encryptedData || !this.sessionKey || !this.credentials) {
      throw new Error('M6 missing data')
    }

    const nonce = Buffer.alloc(12)
    nonce.write('PS-Msg06', 4)
    const decrypted = await ChaCha20Utils.decrypt(this.sessionKey, nonce, encryptedData)

    const innerTlv = TLV8.decodeObject(Buffer.from(decrypted))
    const serverPublicKey = innerTlv[TlvValue.PublicKey]

    if (!serverPublicKey) {
      throw new Error('M6 missing server public key')
    }

    this.credentials.serverPublicKey = new Uint8Array(serverPublicKey)
    return this.credentials
  }
}

/**
 * Handles Pair-Verify V1-V4
 */
class AirPlayVerifyHandler {
  private sessionKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array }
  sharedSecret?: Uint8Array

  constructor(private readonly credentials: AirPlayCredentials) {
    // Generate ephemeral X25519 keypair for this session
    this.sessionKeyPair = X25519Utils.generateKeyPairSync()
  }

  createV1(): Buffer {
    return TLV8.encodeObject({
      [TlvValue.SeqNo]: Buffer.from([State.M1]),
      [TlvValue.PublicKey]: Buffer.from(this.sessionKeyPair.publicKey),
    })
  }

  async processV2AndCreateV3(tlv: TlvData): Promise<Buffer> {
    const serverSessionPubKey = tlv[TlvValue.PublicKey]
    const encryptedData = tlv[TlvValue.EncryptedData]

    if (!serverSessionPubKey || !encryptedData) {
      throw new Error('V2 missing required fields')
    }

    // Compute shared secret
    this.sharedSecret = await X25519Utils.computeSharedSecret(
      this.sessionKeyPair.privateKey,
      serverSessionPubKey
    )

    // Derive verify key
    const verifyKey = await HkdfUtils.derive(
      this.sharedSecret,
      Buffer.from('Pair-Verify-Encrypt-Salt'),
      Buffer.from('Pair-Verify-Encrypt-Info'),
      32
    )

    // Decrypt server data
    const nonce = Buffer.alloc(12)
    nonce.write('PV-Msg02', 4)
    const decrypted = await ChaCha20Utils.decrypt(verifyKey, nonce, encryptedData)

    const innerTlv = TLV8.decodeObject(Buffer.from(decrypted))
    const serverId = innerTlv[TlvValue.Identifier]
    const serverSignature = innerTlv[TlvValue.Signature]

    if (!serverId || !serverSignature) {
      throw new Error('V2 missing server credentials')
    }

    // Verify server signature
    const serverInfo = Buffer.concat([
      serverSessionPubKey,
      serverId,
      Buffer.from(this.sessionKeyPair.publicKey),
    ])

    const valid = await Ed25519Utils.verify(
      serverSignature,
      serverInfo,
      this.credentials.serverPublicKey
    )

    if (!valid) {
      throw new Error('Server signature verification failed')
    }

    // Create our signature
    const clientInfo = Buffer.concat([
      Buffer.from(this.sessionKeyPair.publicKey),
      Buffer.from(this.credentials.identifier, 'utf8'),
      serverSessionPubKey,
    ])
    const signature = await Ed25519Utils.sign(clientInfo, this.credentials.privateKey)

    // Build V3
    const v3Payload = TLV8.encodeObject({
      [TlvValue.Identifier]: Buffer.from(this.credentials.identifier, 'utf8'),
      [TlvValue.Signature]: Buffer.from(signature),
    })

    // Encrypt V3
    const v3Nonce = Buffer.alloc(12)
    v3Nonce.write('PV-Msg03', 4)
    const encrypted = await ChaCha20Utils.encrypt(verifyKey, v3Nonce, v3Payload)

    return TLV8.encodeObject({
      [TlvValue.SeqNo]: Buffer.from([State.M3]),
      [TlvValue.EncryptedData]: Buffer.from(encrypted),
    })
  }

  processV4(tlv: TlvData) {
    // V4 just confirms success (no error = success)
    if (!this.sharedSecret) {
      throw new Error('Shared secret not established')
    }

    // Derive AirPlay session keys
    // KEY DIFFERENCE: AirPlay uses "Control-Salt" not empty salt
    return HkdfUtils.deriveAirPlaySessionKeysSync(this.sharedSecret)
  }
}
