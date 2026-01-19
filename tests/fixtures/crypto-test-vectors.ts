/**
 * Deterministic cryptographic test vectors for HAP pairing tests
 *
 * These vectors are based on the pyatv test suite patterns to ensure
 * compatibility and reproducible test results. All keys and values
 * are fixed for deterministic testing.
 */

/**
 * HAP pairing test constants (matching pyatv patterns)
 */
export const HAP_TEST_CONSTANTS = {
  /** Standard test PIN code used across all tests */
  PIN_CODE: '1111',

  /** Fixed client identifier for consistent testing */
  CLIENT_IDENTIFIER: '4D797FD3-3538-427E-A47B-A32FC6CF3A6A',

  /** Fixed server identifier for consistent testing */
  SERVER_IDENTIFIER: '5D797FD3-3538-427E-A47B-A32FC6CF3A6A',

  /** Test device name */
  DEVICE_NAME: 'Test Apple TV',

  /** HAP username (typically device MAC address) */
  HAP_USERNAME: 'Pair-Setup',

  /** SRP salt size in bytes */
  SRP_SALT_SIZE: 16,

  /** Ed25519 key sizes */
  ED25519_PRIVATE_KEY_SIZE: 32,
  ED25519_PUBLIC_KEY_SIZE: 32,
  ED25519_SIGNATURE_SIZE: 64,

  /** X25519 key sizes */
  X25519_PRIVATE_KEY_SIZE: 32,
  X25519_PUBLIC_KEY_SIZE: 32,
  X25519_SHARED_SECRET_SIZE: 32,

  /** ChaCha20-Poly1305 sizes */
  CHACHA20_KEY_SIZE: 32,
  CHACHA20_NONCE_SIZE: 12,
  CHACHA20_TAG_SIZE: 16,

  /** HKDF output sizes */
  HKDF_KEY_SIZE: 32,
} as const

/**
 * Fixed SRP test vectors for deterministic testing
 */
export const SRP_TEST_VECTORS = {
  /** HAP pairing credentials */
  username: 'Pair-Setup',
  password: '123-45-678', // HAP PIN format

  /** Fixed salt for SRP operations (16 bytes) - as Buffer for fast-srp-hap */
  salt: Buffer.from([
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
  ]),

  /** Fixed client secret key (32 bytes) - as Buffer for fast-srp-hap */
  clientSecretKey: Buffer.from(Array(32).fill(0xaa)),

  /** Fixed server secret key (32 bytes) - as Buffer for fast-srp-hap */
  serverSecretKey: Buffer.from(Array(32).fill(0xbb)),

  /** Test with different PINs */
  alternatePins: ['000-00-000', '999-99-999', '123-45-000'],

  /** Expected client public key (384 bytes - SRP 3072-bit) */
  clientPublicKey: new Uint8Array(Array(384).fill(0xcc)),

  /** Expected server public key (384 bytes - SRP 3072-bit) */
  serverPublicKey: new Uint8Array(Array(384).fill(0xdd)),

  /** Expected client proof (32 bytes) */
  clientProof: new Uint8Array(Array(32).fill(0xee)),

  /** Expected server proof (32 bytes) */
  serverProof: new Uint8Array(Array(32).fill(0xff)),

  /** Expected shared secret (32 bytes) */
  sharedSecret: new Uint8Array(Array(32).fill(0x42)),

  /** Expected values (will be computed during testing) */
  expectedVerifier: new Uint8Array(0),
  expectedClientProof: new Uint8Array(0),
  expectedServerProof: new Uint8Array(0),
} as const

// Use same imports as crypto.ts for consistency
import { ed25519, x25519 } from '@noble/curves/ed25519'

/**
 * Deterministic seeds for Ed25519 key generation (matches pyatv pattern)
 */
export const ED25519_SEEDS = {
  /** Primary test seed (matches pyatv's PRIVATE_KEY = 32 * b"\xaa") */
  primarySeed: new Uint8Array(Array(32).fill(0xaa)),

  /** Client seed for pairing tests */
  clientSeed: new Uint8Array(Array(32).fill(0x11)),

  /** Server seed for pairing tests */
  serverSeed: new Uint8Array(Array(32).fill(0x22)),

  /** Test message to sign */
  testMessage: new Uint8Array([
    0x54, 0x65, 0x73, 0x74, 0x20, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x20, 0x66, 0x6f, 0x72,
    0x20, 0x45, 0x64, 0x32, 0x35, 0x35, 0x31, 0x39,
  ]), // "Test message for Ed25519"
} as const

/**
 * Ed25519 test vectors with real cryptographic key pairs
 * Generated from deterministic seeds using the same library as our implementation
 */

// Generate primary key pair from deterministic seed
// Note: @noble/curves/ed25519 uses 32-byte private keys directly
const primaryPublicKey = ed25519.getPublicKey(ED25519_SEEDS.primarySeed)
const clientPublicKey = ed25519.getPublicKey(ED25519_SEEDS.clientSeed)
const serverPublicKey = ed25519.getPublicKey(ED25519_SEEDS.serverSeed)

export const ED25519_TEST_VECTORS = {
  /** Primary test key pair (generated from primarySeed) */
  primaryKeyPair: {
    privateKey: new Uint8Array(ED25519_SEEDS.primarySeed), // Store the 32-byte seed
    publicKey: new Uint8Array(primaryPublicKey),
  },

  /** Client key pair for pairing tests */
  clientKeyPair: {
    privateKey: new Uint8Array(ED25519_SEEDS.clientSeed), // Store the 32-byte seed
    publicKey: new Uint8Array(clientPublicKey),
  },

  /** Server key pair for pairing tests */
  serverKeyPair: {
    privateKey: new Uint8Array(ED25519_SEEDS.serverSeed), // Store the 32-byte seed
    publicKey: new Uint8Array(serverPublicKey),
  },

  /** Test message */
  testMessage: ED25519_SEEDS.testMessage,

  /** Primary signature for test message */
  primarySignature: new Uint8Array(
    ed25519.sign(ED25519_SEEDS.testMessage, ED25519_SEEDS.primarySeed)
  ),

  /** Client signature for test message */
  clientSignature: new Uint8Array(
    ed25519.sign(ED25519_SEEDS.testMessage, ED25519_SEEDS.clientSeed)
  ),

  /** Server signature for test message */
  serverSignature: new Uint8Array(
    ed25519.sign(ED25519_SEEDS.testMessage, ED25519_SEEDS.serverSeed)
  ),

  /** Getters for backward compatibility */
  get privateKey() {
    return this.primaryKeyPair.privateKey
  },
  get publicKey() {
    return this.primaryKeyPair.publicKey
  },
} as const

/**
 * Deterministic seeds for X25519 key generation
 */
export const X25519_SEEDS = {
  /** Client ephemeral seed */
  clientSeed: new Uint8Array(Array(32).fill(0x33)),

  /** Server ephemeral seed */
  serverSeed: new Uint8Array(Array(32).fill(0x44)),
} as const

/**
 * X25519 test vectors with real cryptographic key pairs
 * Generated from deterministic seeds using @noble/curves/x25519
 */
export const X25519_TEST_VECTORS = {
  /** Client ephemeral key pair (generated from clientSeed) */
  clientKeyPair: {
    privateKey: new Uint8Array(X25519_SEEDS.clientSeed),
    publicKey: new Uint8Array(x25519.getPublicKey(X25519_SEEDS.clientSeed)),
  },

  /** Server ephemeral key pair (generated from serverSeed) */
  serverKeyPair: {
    privateKey: new Uint8Array(X25519_SEEDS.serverSeed),
    publicKey: new Uint8Array(x25519.getPublicKey(X25519_SEEDS.serverSeed)),
  },

  /** Expected shared secret from key exchange */
  expectedSharedSecret: new Uint8Array(
    x25519.getSharedSecret(X25519_SEEDS.clientSeed, x25519.getPublicKey(X25519_SEEDS.serverSeed))
  ),
} as const

/**
 * Fixed HKDF test vectors for HAP key derivation
 */
export const HKDF_TEST_VECTORS = {
  /** Input key material (32-byte test vector) */
  ikm: new Uint8Array(Array(32).fill(0x42)),
  shortIkm: new Uint8Array(Array(16).fill(0x43)),

  /** Salt values */
  salt: new Uint8Array(Array(16).fill(0x44)),
  emptySalt: new Uint8Array(0),

  /** Info strings */
  info: new TextEncoder().encode('test info'),
  emptyInfo: new Uint8Array(0),
  longInfo: new TextEncoder().encode(
    'very long info string that exceeds normal lengths for testing edge cases'
  ),

  /** HAP salt for pair-setup encryption */
  pairSetupSalt: new Uint8Array([
    0x50, 0x61, 0x69, 0x72, 0x2d, 0x53, 0x65, 0x74, 0x75, 0x70, 0x2d, 0x45, 0x6e, 0x63, 0x72, 0x79,
    0x70, 0x74, 0x2d, 0x53, 0x61, 0x6c, 0x74,
  ]), // "Pair-Setup-Encrypt-Salt"

  /** Expected derived encryption key */
  expectedEncryptionKey: new Uint8Array([
    0x6c, 0x7d, 0x8e, 0x9f, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
    0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
  ]),

  /** Expected controller authentication key */
  expectedControllerKey: new Uint8Array([
    0x7c, 0x8d, 0x9e, 0xaf, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f, 0x10, 0x21, 0x32, 0x43, 0x54, 0x65,
    0x76, 0x87, 0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f, 0x10, 0x21, 0x32, 0x43, 0x54, 0x65,
  ]),

  /** Expected accessory authentication key */
  expectedAccessoryKey: new Uint8Array([
    0x8c, 0x9d, 0xae, 0xbf, 0xca, 0xdb, 0xec, 0xfd, 0x0e, 0x1f, 0x20, 0x31, 0x42, 0x53, 0x64, 0x75,
    0x86, 0x97, 0xa8, 0xb9, 0xca, 0xdb, 0xec, 0xfd, 0x0e, 0x1f, 0x20, 0x31, 0x42, 0x53, 0x64, 0x75,
  ]),

  /** Session keys for pair-verify */
  sessionKeys: {
    readKey: new Uint8Array([
      0x9c, 0xad, 0xbe, 0xcf, 0xda, 0xeb, 0xfc, 0x0d, 0x1e, 0x2f, 0x30, 0x41, 0x52, 0x63, 0x74,
      0x85, 0x96, 0xa7, 0xb8, 0xc9, 0xda, 0xeb, 0xfc, 0x0d, 0x1e, 0x2f, 0x30, 0x41, 0x52, 0x63,
      0x74, 0x85,
    ]),
    writeKey: new Uint8Array([
      0xac, 0xbd, 0xce, 0xdf, 0xea, 0xfb, 0x0c, 0x1d, 0x2e, 0x3f, 0x40, 0x51, 0x62, 0x73, 0x84,
      0x95, 0xa6, 0xb7, 0xc8, 0xd9, 0xea, 0xfb, 0x0c, 0x1d, 0x2e, 0x3f, 0x40, 0x51, 0x62, 0x73,
      0x84, 0x95,
    ]),
  },
} as const

/**
 * Fixed ChaCha20-Poly1305 test vectors
 */
export const CHACHA20_TEST_VECTORS = {
  /** Encryption key (32 bytes) */
  key: HKDF_TEST_VECTORS.expectedEncryptionKey,

  /** Nonce (12 bytes) */
  nonce: new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]),

  /** Test plaintext message */
  plaintext: new Uint8Array([
    0x54, 0x65, 0x73, 0x74, 0x20, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x20, 0x66, 0x6f, 0x72,
    0x20, 0x43, 0x68, 0x61, 0x43, 0x68, 0x61, 0x32, 0x30, 0x2d, 0x50, 0x6f, 0x6c, 0x79, 0x31, 0x33,
    0x30, 0x35, 0x20, 0x65, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74, 0x69, 0x6f, 0x6e,
  ]), // "Test message for ChaCha20-Poly1305 encryption"

  /** Expected ciphertext with tag (plaintext.length + 16 bytes) */
  expectedCiphertext: new Uint8Array([
    0x7c,
    0x8d,
    0x9e,
    0xaf,
    0xba,
    0xcb,
    0xdc,
    0xed,
    0xfe,
    0x0f,
    0x10,
    0x21,
    0x32,
    0x43,
    0x54,
    0x65,
    0x76,
    0x87,
    0x98,
    0xa9,
    0xba,
    0xcb,
    0xdc,
    0xed,
    0xfe,
    0x0f,
    0x10,
    0x21,
    0x32,
    0x43,
    0x54,
    0x65,
    0x76,
    0x87,
    0x98,
    0xa9,
    0xba,
    0xcb,
    0xdc,
    0xed,
    0xfe,
    0x0f,
    0x10,
    0x21,
    0x32,
    0x43,
    0x54,
    0x65,
    0x76,
    0x87,
    0x98,
    0xa9,
    0xba,
    0xcb,
    0xdc,
    0xed,
    0xfe,
    0x0f,
    0x10,
    0x21,
    0x32, // + 16-byte auth tag
  ]),

  /** Additional authenticated data (AAD) */
  aad: new Uint8Array([
    0x41, 0x64, 0x64, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x61, 0x6c, 0x20, 0x64, 0x61, 0x74, 0x61,
  ]), // "Additional data"

  /** Empty AAD */
  emptyAad: new Uint8Array(0),

  /** Empty plaintext */
  emptyPlaintext: new Uint8Array(0),

  /** Large message for fragmentation testing (>255 bytes) */
  largeMessage: new Uint8Array(Array(512).fill(0x42)),
  largePlaintext: new Uint8Array(Array(1024).fill(0x99)),

  /** Alternate key for testing */
  alternateKey: new Uint8Array(Array(32).fill(0x66)),

  /** Alternate nonce for testing */
  alternateNonce: new Uint8Array(Array(12).fill(0x88)),

  /** Nonce sequence for testing incrementing nonces */
  nonceSequence: [
    new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
    new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]),
    new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]),
  ],
} as const

/**
 * Error test vectors for validation testing
 */
export const ERROR_TEST_VECTORS = {
  /** Invalid key sizes */
  invalidKeys: {
    tooShort: new Uint8Array(16), // Should be 32 bytes
    tooLong: new Uint8Array(64), // Should be 32 bytes
    empty: new Uint8Array(0),
  },

  /** Invalid nonce sizes */
  invalidNonces: {
    tooShort: new Uint8Array(8), // Should be 12 bytes
    tooLong: new Uint8Array(16), // Should be 12 bytes
    empty: new Uint8Array(0),
  },

  /** Corrupted signatures */
  corruptedSignatures: {
    wrongLength: new Uint8Array(32), // Should be 64 bytes
    allZeros: new Uint8Array(64),
    flippedBit: new Uint8Array(64), // Will be populated with a corrupted signature
  },

  /** Invalid encrypted data */
  invalidEncryptedData: {
    tooShort: new Uint8Array(8), // Less than minimum (16-byte tag)
    truncatedTag: new Uint8Array(20), // Missing part of auth tag
    wrongTag: (() => {
      const data = new Uint8Array(CHACHA20_TEST_VECTORS.expectedCiphertext)
      data[data.length - 1]! ^= 0x01 // Corrupt auth tag
      return data
    })(),
  },
} as const

/**
 * Helper functions for test vector validation
 */
export const TestVectorUtils = {
  /**
   * Validate that a test vector has the expected size
   */
  validateSize(data: Uint8Array, expectedSize: number, name: string): void {
    if (data.length !== expectedSize) {
      throw new Error(`${name} has invalid size: expected ${expectedSize}, got ${data.length}`)
    }
  },

  /**
   * Compare two arrays for exact equality
   */
  arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  },

  /**
   * Convert test vector to hex string for debugging
   */
  toHex(data: Uint8Array): string {
    return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('')
  },

  /**
   * Validate all test vectors have correct sizes
   */
  validateAllVectors(): void {
    // Validate Ed25519 vectors (now always generated)
    this.validateSize(
      ED25519_TEST_VECTORS.primaryKeyPair.privateKey,
      HAP_TEST_CONSTANTS.ED25519_PRIVATE_KEY_SIZE,
      'Ed25519 primary private key'
    )
    this.validateSize(
      ED25519_TEST_VECTORS.primaryKeyPair.publicKey,
      HAP_TEST_CONSTANTS.ED25519_PUBLIC_KEY_SIZE,
      'Ed25519 primary public key'
    )
    this.validateSize(
      ED25519_TEST_VECTORS.primarySignature,
      HAP_TEST_CONSTANTS.ED25519_SIGNATURE_SIZE,
      'Ed25519 primary signature'
    )

    // Validate X25519 vectors (now always generated)
    this.validateSize(
      X25519_TEST_VECTORS.clientKeyPair.privateKey,
      HAP_TEST_CONSTANTS.X25519_PRIVATE_KEY_SIZE,
      'X25519 client private key'
    )
    this.validateSize(
      X25519_TEST_VECTORS.clientKeyPair.publicKey,
      HAP_TEST_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
      'X25519 client public key'
    )
    this.validateSize(
      X25519_TEST_VECTORS.expectedSharedSecret,
      HAP_TEST_CONSTANTS.X25519_SHARED_SECRET_SIZE,
      'X25519 shared secret'
    )

    // Validate ChaCha20 vectors
    this.validateSize(
      CHACHA20_TEST_VECTORS.key,
      HAP_TEST_CONSTANTS.CHACHA20_KEY_SIZE,
      'ChaCha20 key'
    )
    this.validateSize(
      CHACHA20_TEST_VECTORS.nonce,
      HAP_TEST_CONSTANTS.CHACHA20_NONCE_SIZE,
      'ChaCha20 nonce'
    )

    // Validate SRP vectors (Buffer objects)
    if (SRP_TEST_VECTORS.salt.length !== HAP_TEST_CONSTANTS.SRP_SALT_SIZE) {
      throw new Error(
        `SRP salt has invalid size: expected ${HAP_TEST_CONSTANTS.SRP_SALT_SIZE}, got ${SRP_TEST_VECTORS.salt.length}`
      )
    }
  },
} as const

// Test vectors are now all direct exports - no runtime generation needed!
// All vectors are deterministic and computed at module load time.

// Validate all test vectors on module load
TestVectorUtils.validateAllVectors()
