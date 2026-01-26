import { BunOptimizedUtils, NonceFormat } from '@/core/encoding/buffer-utils.ts'
import { ChaCha20Utils } from '@/core/crypto/chacha20.ts'
import { createLogger } from '@/logging/logging.ts'
import type { DerivedKeys } from '@/core/crypto/hkdf.ts'



/**
 * Encryption layer states
 */
export enum EncryptionState {
  /** No encryption keys set */
  Disabled = 'disabled',
  /** Keys set, encryption active */
  Enabled = 'enabled',
  /** Encryption error occurred */
  Error = 'error',
}

const logger = createLogger("bunatv:companion:chacha20-encryption");

/**
 * ChaCha20 encryption layer implementation
 */
export class ChaCha20EncryptionLayer {
  private _state: EncryptionState = EncryptionState.Disabled
  private sessionKeys?: DerivedKeys
  private sendNonce: number = 0
  private receiveNonce: number = 0
  private nonceFormat: NonceFormat = NonceFormat.Companion
  constructor(options?: {format?: NonceFormat}) {
    this.nonceFormat = options?.format ?? NonceFormat.Companion
  }

  get state(): EncryptionState {
    return this._state
  }

  get isEnabled(): boolean {
    return this._state === EncryptionState.Enabled
  }

  enable(keys: DerivedKeys): void {
    logger.info(
      {
        writeKeyHex: Buffer.from(keys.writeKey).toString('hex'),
        readKeyHex: Buffer.from(keys.readKey).toString('hex'),
      },
      'Enabling ChaCha20 encryption with session keys'
    )

    this.sessionKeys = keys
    this.sendNonce = 0
    this.receiveNonce = 0
    this._state = EncryptionState.Enabled

    logger.info('ChaCha20 encryption enabled - nonces reset to 0')
  }

  disable(): void {
    logger.info('Disabling ChaCha20 encryption')
    this.sessionKeys = undefined
    this.sendNonce = 0
    this.receiveNonce = 0
    this._state = EncryptionState.Disabled
    logger.debug('ChaCha20 encryption disabled')
  }

  encrypt(data: Buffer, aad?: Buffer): Buffer {
    if (!this.isEnabled || !this.sessionKeys) {
      logger.trace({ dataLength: data.length }, 'Encryption bypassed - layer disabled')
      return data // Pass through if not enabled
    }

    try {
      const counterValue = this.sendNonce
      const nonce = BunOptimizedUtils.createNonce(this.sendNonce++, this.nonceFormat)

      // DETAILED DEBUG LOGGING
      logger.info(
        {
          aadHex: aad ? aad.toString('hex') : undefined,
          counter: counterValue,
          nonce: Buffer.from(nonce).toString('hex'),
          plaintextLength: data.length,
        },
        '🔐 ENCRYPTING: ' + aad?.toString('hex')
      )

      const encrypted = ChaCha20Utils.encryptSync(
        this.sessionKeys.writeKey,
        nonce,
        new Uint8Array(data),
        aad ? new Uint8Array(aad) : undefined
      )

      logger.info(
        {
          encryptedLength: encrypted.length,
          authTagHex: Buffer.from(encrypted.slice(-16)).toString('hex'),
        },
        '✅ ENCRYPTED'
      )

      return Buffer.from(encrypted)
    } catch (error) {
      logger.error({ error, nonce: this.sendNonce - 1 }, 'Encryption failed')
      this._state = EncryptionState.Error
      throw new Error(`Encryption failed: ${error}`)
    }
  }

  decrypt(data: Buffer, aad?: Buffer): Buffer {
    if (!this.isEnabled || !this.sessionKeys) {
      logger.trace({ dataLength: data.length }, 'Decryption bypassed - layer disabled')
      return data // Pass through if not enabled
    }

    try {
      const counterValue = this.receiveNonce
      const nonce = BunOptimizedUtils.createNonce(this.receiveNonce++, this.nonceFormat)

      logger.trace(
        {
          dataLength: data.length,
          counter: counterValue,
          nonce: Buffer.from(nonce).toString('hex'),
          hasAad: !!aad,
          aadLength: aad?.length,
          aadHex: aad ? aad.toString('hex') : undefined,
        },
        'Decrypting data'
      )

      const decrypted = ChaCha20Utils.decryptSync(
        this.sessionKeys.readKey,
        nonce,
        new Uint8Array(data),
        aad ? new Uint8Array(aad) : undefined
      )

      return Buffer.from(decrypted)
    } catch (error) {
      logger.error({ error, nonce: this.receiveNonce - 1 }, 'Decryption failed')
      this._state = EncryptionState.Error
      throw new Error(`Decryption failed: ${error}`)
    }
  }

  resetNonces(): void {
    logger.debug(
      { previousSendNonce: this.sendNonce, previousReceiveNonce: this.receiveNonce },
      'Resetting nonces'
    )
    this.sendNonce = 0
    this.receiveNonce = 0
    logger.trace('Nonces reset to zero')
  }
}
