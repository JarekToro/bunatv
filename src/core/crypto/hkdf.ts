/**
 * HKDF (HMAC-based Key Derivation Function) utilities for HAP key derivation
 *
 * Implements HKDF-SHA512 for deriving cryptographic keys from shared secrets
 * in the HAP pairing and verification processes.
 */

import crypto from 'node:crypto'
import { createLogger } from '../../logging/logging'
import { CryptoError } from './errors'
import { HAP_SALT, HAP_INFO, COMPANION_CRYPTO, AIRPLAY_CRYPTO } from './constants'

const logger = createLogger("bunatv:crypto:hkdf");

export type DerivedKeys = {
  readKey: Uint8Array
  writeKey: Uint8Array
}
/**
 * HKDF utilities for HAP key derivation - Bun Native Implementation
 */
export class HkdfUtils {
  /**
   * Derive key using HKDF-SHA512 (Bun native)
   *
   * @param inputKeyMaterial - Input key material (shared secret)
   * @param salt - Salt value
   * @param info - Context information
   * @param length - Desired output length in bytes
   * @returns Derived key
   */
  static async derive(
    inputKeyMaterial: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number
  ): Promise<Uint8Array> {
    // Validate length parameter
    if (length <= 0) {
      throw new CryptoError('HKDF length must be greater than 0')
    }

    return new Promise((resolve, reject) => {
      try {
        // Use Bun's native crypto.hkdf (available in Bun v1.2.6+)
        crypto.hkdf(
          'sha512',
          Buffer.from(inputKeyMaterial),
          Buffer.from(salt),
          Buffer.from(info),
          length,
          (err, derivedKey) => {
            if (err) {
              reject(new CryptoError('Failed to derive key with HKDF', err))
            } else {
              resolve(new Uint8Array(derivedKey))
            }
          }
        )
      } catch (error) {
        reject(new CryptoError('Failed to derive key with HKDF', error as Error))
      }
    })
  }

  /**
   * HKDF key derivation synchronously (Bun optimized)
   * Uses Bun's native crypto.hkdfSync (available in Bun v1.2.6+)
   */
  static deriveSync(
    inputKeyMaterial: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number
  ): Uint8Array {
    // Validate length parameter
    if (length <= 0) {
      throw new CryptoError('HKDF length must be greater than 0')
    }

    try {
      // Use Bun's native crypto.hkdfSync
      const derivedKey = crypto.hkdfSync(
        'sha512',
        Buffer.from(inputKeyMaterial),
        Buffer.from(salt),
        Buffer.from(info),
        length
      )
      return new Uint8Array(derivedKey)
    } catch (error) {
      throw new CryptoError('Failed to derive key with HKDF', error as Error)
    }
  }

  /**
   * Derive pairing encryption key (async)
   * Uses proper HAP-compliant salt and info strings
   *
   * @param sharedSecret - SRP session key (needs hex transformation)
   * @returns 32-byte encryption key
   */
  static async derivePairSetupKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
    logger.debug(
      `derivePairSetupKey: input=${sharedSecret.length}B, hex=${Buffer.from(sharedSecret).toString('hex').substring(0, 32)}...`
    )

    // Transform SRP key like PyATV does: convert to hex string then back to bytes
    const hexString = Buffer.from(sharedSecret).toString('hex')
    const transformedKey = Buffer.from(hexString, 'hex')

    logger.debug(
      `derivePairSetupKey: transformed=${transformedKey.length}B, hex=${transformedKey.toString('hex').substring(0, 32)}...`
    )
    logger.debug(
      `derivePairSetupKey: salt="${HAP_SALT.PAIR_SETUP_ENCRYPT.toString('utf8')}", info="${HAP_INFO.PAIR_SETUP_ENCRYPT_INFO.toString('utf8')}"`
    )

    const result = await this.derive(
      transformedKey,
      HAP_SALT.PAIR_SETUP_ENCRYPT,
      HAP_INFO.PAIR_SETUP_ENCRYPT_INFO,
      32
    )
    logger.debug(
      `derivePairSetupKey: result=${result.length}B, hex=${Buffer.from(result).toString('hex').substring(0, 32)}...`
    )
    return result
  }

  /**
   * Derive controller authentication key for pairing (async)
   * Uses proper HAP-compliant salt and info strings
   *
   * @param sharedSecret - SRP session key (needs hex transformation)
   * @returns 32-byte authentication key (ios_device_x)
   */
  static async deriveControllerKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
    logger.debug(
      `deriveControllerKey: input=${sharedSecret.length}B, hex=${Buffer.from(sharedSecret).toString('hex').substring(0, 32)}...`
    )

    // Transform SRP key like PyATV does: convert to hex string then back to bytes
    const hexString = Buffer.from(sharedSecret).toString('hex')
    const transformedKey = Buffer.from(hexString, 'hex')

    logger.debug(
      `deriveControllerKey: transformed=${transformedKey.length}B, hex=${transformedKey.toString('hex').substring(0, 32)}...`
    )
    logger.debug(
      `deriveControllerKey: salt="${HAP_SALT.PAIR_SETUP_CONTROLLER.toString('utf8')}", info="${HAP_INFO.PAIR_SETUP_CONTROLLER_SIGN_INFO.toString('utf8')}"`
    )

    const result = await this.derive(
      transformedKey,
      HAP_SALT.PAIR_SETUP_CONTROLLER,
      HAP_INFO.PAIR_SETUP_CONTROLLER_SIGN_INFO,
      32
    )
    logger.debug(
      `deriveControllerKey: result=${result.length}B, hex=${Buffer.from(result).toString('hex').substring(0, 32)}...`
    )
    return result
  }

  /**
   * Derive accessory authentication key for pairing (async)
   *
   * @param sharedSecret - X25519 shared secret
   * @returns 32-byte authentication key
   */
  static async deriveAccessoryKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
    return await this.derive(sharedSecret, HAP_SALT.PAIR_SETUP_ACCESSORY, Buffer.alloc(0), 32)
  }

  /**
   * Derive session encryption keys (async)
   *
   * @param sharedSecret - Pair-verify shared secret
   * @returns Object with read and write keys
   */
  static async deriveSessionKeys(sharedSecret: Uint8Array): Promise<{
    readKey: Uint8Array
    writeKey: Uint8Array
  }> {
    const [readKey, writeKey] = await Promise.all([
      this.derive(sharedSecret, HAP_SALT.PAIR_VERIFY_ENCRYPT, HAP_INFO.CONTROL_READ, 32),
      this.derive(sharedSecret, HAP_SALT.PAIR_VERIFY_ENCRYPT, HAP_INFO.CONTROL_WRITE, 32),
    ])

    return { readKey, writeKey }
  }

  /**
   * Derive pairing encryption key synchronously (Bun optimized)
   * Uses proper HAP-compliant salt and info strings
   */
  static derivePairSetupKeySync(sharedSecret: Uint8Array): Uint8Array {
    // Transform SRP key like PyATV does: convert to hex string then back to bytes
    const hexString = Buffer.from(sharedSecret).toString('hex')
    const transformedKey = Buffer.from(hexString, 'hex')

    return this.deriveSync(
      transformedKey,
      HAP_SALT.PAIR_SETUP_ENCRYPT,
      HAP_INFO.PAIR_SETUP_ENCRYPT_INFO,
      32
    )
  }

  /**
   * Derive controller authentication key synchronously (Bun optimized)
   * Uses proper HAP-compliant salt and info strings
   */
  static deriveControllerKeySync(sharedSecret: Uint8Array): Uint8Array {
    // Transform SRP key like PyATV does: convert to hex string then back to bytes
    const hexString = Buffer.from(sharedSecret).toString('hex')
    const transformedKey = Buffer.from(hexString, 'hex')

    return this.deriveSync(
      transformedKey,
      HAP_SALT.PAIR_SETUP_CONTROLLER,
      HAP_INFO.PAIR_SETUP_CONTROLLER_SIGN_INFO,
      32
    )
  }

  /**
   * Derive accessory authentication key synchronously (Bun optimized)
   */
  static deriveAccessoryKeySync(sharedSecret: Uint8Array): Uint8Array {
    return this.deriveSync(sharedSecret, HAP_SALT.PAIR_SETUP_ACCESSORY, Buffer.alloc(0), 32)
  }

  /**
   * Derive session encryption keys synchronously (Bun optimized)
   */
  static deriveSessionKeysSync(sharedSecret: Uint8Array): DerivedKeys {
    const readKey = this.deriveSync(
      sharedSecret,
      HAP_SALT.PAIR_VERIFY_ENCRYPT,
      HAP_INFO.CONTROL_READ,
      32
    )
    const writeKey = this.deriveSync(
      sharedSecret,
      HAP_SALT.PAIR_VERIFY_ENCRYPT,
      HAP_INFO.CONTROL_WRITE,
      32
    )

    return { readKey, writeKey }
  }

  static deriveAirPlaySessionKeysSync(sharedSecret: Uint8Array): DerivedKeys {
    logger.info('Deriving AirPlay protocol session keys')

    // Server encrypts with ServerEncrypt-main, we decrypt with it
    const readKey = this.deriveSync(
      sharedSecret,
      AIRPLAY_CRYPTO.SESSION_SALT,
      AIRPLAY_CRYPTO.SERVER_ENCRYPT_INFO,
      32
    )
    // We encrypt with ClientEncrypt-main
    const writeKey = this.deriveSync(
      sharedSecret,
      AIRPLAY_CRYPTO.SESSION_SALT,
      AIRPLAY_CRYPTO.CLIENT_ENCRYPT_INFO,
      32
    )

    logger.info(
      {
        sharedSecretHex: Buffer.from(sharedSecret).toString('hex'),
        sharedSecretLength: sharedSecret.length,
        saltHex: AIRPLAY_CRYPTO.SESSION_SALT.toString('hex') || '(empty)',
        saltLength: AIRPLAY_CRYPTO.SESSION_SALT.length,
        writeInfo: AIRPLAY_CRYPTO.CLIENT_ENCRYPT_INFO.toString('utf8'),
        readInfo: AIRPLAY_CRYPTO.SERVER_ENCRYPT_INFO.toString('utf8'),
        readKeyHex: Buffer.from(readKey).toString('hex'), // Full key
        writeKeyHex: Buffer.from(writeKey).toString('hex'), // Full key
      },
      '✅ Derived AirPlay protocol session keys'
    )

    return { readKey, writeKey }
  }

  /**
   * Derive Companion protocol session keys synchronously
   *
   * Companion protocol uses different HKDF parameters than standard HAP:
   * - Salt: empty string (not "Pair-Verify-Encrypt-Salt")
   * - Info: "ClientEncrypt-main" / "ServerEncrypt-main" (not "Control-*-Encryption-Key")
   *
   * Based on pyatv's implementation for Apple TV Companion Link
   */
  static deriveCompanionSessionKeysSync(sharedSecret: Uint8Array): DerivedKeys {
    logger.info('Deriving Companion protocol session keys')

    // Server encrypts with ServerEncrypt-main, we decrypt with it
    const readKey = this.deriveSync(
      sharedSecret,
      COMPANION_CRYPTO.SESSION_SALT,
      COMPANION_CRYPTO.SERVER_ENCRYPT_INFO,
      32
    )
    // We encrypt with ClientEncrypt-main
    const writeKey = this.deriveSync(
      sharedSecret,
      COMPANION_CRYPTO.SESSION_SALT,
      COMPANION_CRYPTO.CLIENT_ENCRYPT_INFO,
      32
    )

    logger.info(
      {
        sharedSecretHex: Buffer.from(sharedSecret).toString('hex'),
        sharedSecretLength: sharedSecret.length,
        saltHex: COMPANION_CRYPTO.SESSION_SALT.toString('hex') || '(empty)',
        saltLength: COMPANION_CRYPTO.SESSION_SALT.length,
        writeInfo: COMPANION_CRYPTO.CLIENT_ENCRYPT_INFO.toString('utf8'),
        readInfo: COMPANION_CRYPTO.SERVER_ENCRYPT_INFO.toString('utf8'),
        readKeyHex: Buffer.from(readKey).toString('hex'), // Full key
        writeKeyHex: Buffer.from(writeKey).toString('hex'), // Full key
      },
      '✅ Derived Companion protocol session keys'
    )

    return { readKey, writeKey }
  }
}
