/**
 * Cryptographic constants for HAP (HomeKit Accessory Protocol) operations
 *
 * These constants define the salt and info values used in HKDF key derivation
 * for the HAP pairing and verification processes.
 */

/**
 * HAP-specific salt constants for HKDF operations
 */
export const HAP_SALT = {
  /** Salt for deriving pairing encryption keys */
  PAIR_SETUP_ENCRYPT: Buffer.from('Pair-Setup-Encrypt-Salt', 'utf8'),
  /** Salt for deriving pairing authentication keys */
  PAIR_SETUP_CONTROLLER: Buffer.from('Pair-Setup-Controller-Sign-Salt', 'utf8'),
  /** Salt for deriving accessory authentication keys */
  PAIR_SETUP_ACCESSORY: Buffer.from('Pair-Setup-Accessory-Sign-Salt', 'utf8'),
  /** Salt for deriving session encryption keys */
  PAIR_VERIFY_ENCRYPT: Buffer.from('Pair-Verify-Encrypt-Salt', 'utf8'),
  /** Salt for deriving session authentication keys */
  PAIR_VERIFY_INFO: Buffer.from('Pair-Verify-Encrypt-Info', 'utf8'),
}

/**
 * HAP info strings for HKDF operations
 */
export const HAP_INFO = {
  /** Info for controller-to-accessory encryption */
  CONTROL_READ: Buffer.from('Control-Read-Encryption-Key', 'utf8'),
  /** Info for accessory-to-controller encryption */
  CONTROL_WRITE: Buffer.from('Control-Write-Encryption-Key', 'utf8'),
  /** Info for pair-setup controller signature */
  PAIR_SETUP_CONTROLLER_SIGN_INFO: Buffer.from('Pair-Setup-Controller-Sign-Info', 'utf8'),
  /** Info for pair-setup encryption */
  PAIR_SETUP_ENCRYPT_INFO: Buffer.from('Pair-Setup-Encrypt-Info', 'utf8'),
}

/**
 * Companion Protocol specific constants (different from standard HAP)
 * Based on pyatv implementation for Apple TV Companion Link
 */
export const COMPANION_CRYPTO = {
  /** Salt for Companion session keys (empty string!) */
  SESSION_SALT: Buffer.alloc(0),
  /** Info for client-to-server encryption (data we send) */
  CLIENT_ENCRYPT_INFO: Buffer.from('ClientEncrypt-main', 'utf8'),
  /** Info for server-to-client encryption (data we receive) */
  SERVER_ENCRYPT_INFO: Buffer.from('ServerEncrypt-main', 'utf8'),
}

/**
 * Airplay Protocol specific constants
 * Based on pyatv implementation for AirPlay
 */
export const AIRPLAY_CRYPTO = {
  /** Salt for AirPlay session keys */
  SESSION_SALT: Buffer.from('Control-Salt', 'utf8'),
  /** Info for client-to-server encryption (data we send) */
  CLIENT_ENCRYPT_INFO: Buffer.from('Control-Write-Encryption-Key', 'utf8'),
  /** Info for server-to-client encryption (data we receive) */
  SERVER_ENCRYPT_INFO: Buffer.from('Control-Read-Encryption-Key', 'utf8'),
}


export const AIRPLAY_EVENT_CRYPTO = {
  SESSION_SALT: Buffer.from('Events-Salt', 'utf8'),
  // Reversed because connection originates from receiver
  CLIENT_ENCRYPT_INFO: Buffer.from('Events-Read-Encryption-Key', 'utf8'),
  SERVER_ENCRYPT_INFO: Buffer.from('Events-Write-Encryption-Key', 'utf8'),
}

export const AIRPLAY_DATASTREAM_CRYPTO = {
  SALT_PREFIX: Buffer.from('DataStream-Salt', 'utf8'),
  INPUT_INFO: Buffer.from('DataStream-Input-Encryption-Key', 'utf8'),
  OUTPUT_INFO: Buffer.from('DataStream-Output-Encryption-Key', 'utf8'),
}

/**
 * SRP configuration for HAP pairing
 */
export const SRP_CONFIG = {
  /** Prime number size in bits (HAP uses 3072-bit primes) */
  PRIME_BITS: 3072,
  /** Hash algorithm for SRP operations */
  HASH_ALGORITHM: 'sha512' as const,
  /** Generator value */
  GENERATOR: 5,
}
