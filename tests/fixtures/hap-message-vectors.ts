/**
 * HAP M1-M6 Message Test Vectors
 *
 * Provides comprehensive test vectors for validating HAP pairing message structure.
 * Based on analysis of pyatv implementation and HAP specification requirements.
 */

import {
  ErrorCode,
  Method,
  State,
  TLV8,
  TlvBuilder,
  type TlvData,
  TlvValue,
} from '@/core/encoding/tlv8.ts'
import { SRP_TEST_VECTORS, X25519_TEST_VECTORS } from './crypto-test-vectors'

/**
 * HAP Message Nonces for ChaCha20-Poly1305 encryption
 */
export const HAP_NONCES = {
  /** M5 message encryption nonce */
  PS_MSG05: Buffer.from('PS-Msg05', 'utf8'),

  /** M6 message decryption nonce */
  PS_MSG06: Buffer.from('PS-Msg06', 'utf8'),

  /** Pair-Verify M2 encryption nonce */
  PV_MSG02: Buffer.from('PV-Msg02', 'utf8'),

  /** Pair-Verify M3 decryption nonce */
  PV_MSG03: Buffer.from('PV-Msg03', 'utf8'),
} as const

/**
 * M1 Message Test Vectors - Initial Pairing Request (Client → Server)
 */
export const M1_MESSAGE_VECTORS = {
  /** Valid M1 message structure */
  validMessage: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M1]),
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M1,
    },
    description: 'Valid M1 pair-setup initiation message',
  },

  /** M1 with pair-setup with auth */
  validWithAuth: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetupWithAuth]),
      [TlvValue.SeqNo]: Buffer.from([State.M1]),
    },
    expectedStructure: {
      method: Method.PairSetupWithAuth,
      seqNo: State.M1,
    },
    description: 'Valid M1 pair-setup with auth message',
  },

  /** M1 for pair-verify */
  pairVerifyM1: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairVerify]),
      [TlvValue.SeqNo]: Buffer.from([State.M1]),
      [TlvValue.PublicKey]: Buffer.from(X25519_TEST_VECTORS.clientKeyPair.publicKey),
    },
    expectedStructure: {
      method: Method.PairVerify,
      seqNo: State.M1,
      publicKey: Buffer.from(X25519_TEST_VECTORS.clientKeyPair.publicKey),
    },
    description: 'Valid M1 pair-verify initiation message',
  },

  /** Invalid M1 messages for error testing */
  invalid: {
    missingMethod: {
      tlvData: {
        [TlvValue.SeqNo]: Buffer.from([State.M1]),
      },
      description: 'M1 message missing required Method field',
    },
    missingSeqNo: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      },
      description: 'M1 message missing required SeqNo field',
    },
    wrongSeqNo: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M2]), // Wrong sequence number
      },
      description: 'M1 message with incorrect sequence number',
    },
    invalidMethod: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([0xff]), // Invalid method
        [TlvValue.SeqNo]: Buffer.from([State.M1]),
      },
      description: 'M1 message with invalid method value',
    },
  },
} as const

/**
 * M2 Message Test Vectors - Server Challenge Response (Server → Client)
 */
export const M2_MESSAGE_VECTORS = {
  /** Valid M2 message for pair-setup */
  validPairSetup: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M2]),
      [TlvValue.Salt]: SRP_TEST_VECTORS.salt,
      [TlvValue.PublicKey]: Buffer.from(SRP_TEST_VECTORS.serverPublicKey),
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M2,
      salt: SRP_TEST_VECTORS.salt,
      publicKey: Buffer.from(SRP_TEST_VECTORS.serverPublicKey),
    },
    description: 'Valid M2 pair-setup server challenge',
  },

  /** Valid M2 message for pair-verify */
  validPairVerify: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairVerify]),
      [TlvValue.SeqNo]: Buffer.from([State.M2]),
      [TlvValue.PublicKey]: Buffer.from(X25519_TEST_VECTORS.serverKeyPair.publicKey),
      [TlvValue.EncryptedData]: Buffer.from(Array(64).fill(0xaa)), // Mock encrypted data
    },
    expectedStructure: {
      method: Method.PairVerify,
      seqNo: State.M2,
      publicKey: Buffer.from(X25519_TEST_VECTORS.serverKeyPair.publicKey),
      encryptedData: Buffer.from(Array(64).fill(0xaa)),
    },
    description: 'Valid M2 pair-verify server response',
  },

  /** M2 error response */
  errorResponse: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M2]),
      [TlvValue.Error]: Buffer.from([ErrorCode.Authentication]),
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M2,
      error: ErrorCode.Authentication,
    },
    description: 'M2 error response for authentication failure',
  },

  /** Invalid M2 messages */
  invalid: {
    missingRequiredFields: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M2]),
        // Missing Salt and PublicKey for pair-setup
      },
      description: 'M2 pair-setup missing required Salt and PublicKey',
    },
    invalidSaltSize: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M2]),
        [TlvValue.Salt]: Buffer.from([0x01, 0x02]), // Too short - should be 16 bytes
        [TlvValue.PublicKey]: Buffer.from(SRP_TEST_VECTORS.serverPublicKey),
      },
      description: 'M2 with invalid salt size',
    },
  },
} as const

/**
 * M3 Message Test Vectors - Client Proof (Client → Server)
 */
export const M3_MESSAGE_VECTORS = {
  /** Valid M3 message for pair-setup */
  validPairSetup: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M3]),
      [TlvValue.PublicKey]: Buffer.from(SRP_TEST_VECTORS.clientPublicKey),
      [TlvValue.Proof]: Buffer.from(SRP_TEST_VECTORS.clientProof),
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M3,
      publicKey: Buffer.from(SRP_TEST_VECTORS.clientPublicKey),
      proof: Buffer.from(SRP_TEST_VECTORS.clientProof),
    },
    description: 'Valid M3 pair-setup client proof',
  },

  /** Valid M3 message for pair-verify */
  validPairVerify: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairVerify]),
      [TlvValue.SeqNo]: Buffer.from([State.M3]),
      [TlvValue.EncryptedData]: Buffer.from(Array(64).fill(0xbb)), // Mock encrypted signature
    },
    expectedStructure: {
      method: Method.PairVerify,
      seqNo: State.M3,
      encryptedData: Buffer.from(Array(64).fill(0xbb)),
    },
    description: 'Valid M3 pair-verify client signature',
  },

  /** Invalid M3 messages */
  invalid: {
    missingProof: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M3]),
        [TlvValue.PublicKey]: Buffer.from(SRP_TEST_VECTORS.clientPublicKey),
        // Missing Proof
      },
      description: 'M3 pair-setup missing required Proof',
    },
    invalidProofSize: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M3]),
        [TlvValue.PublicKey]: Buffer.from(SRP_TEST_VECTORS.clientPublicKey),
        [TlvValue.Proof]: Buffer.from([0x01, 0x02]), // Too short
      },
      description: 'M3 with invalid proof size',
    },
  },
} as const

/**
 * M4 Message Test Vectors - Server Proof (Server → Client)
 */
export const M4_MESSAGE_VECTORS = {
  /** Valid M4 message for pair-setup */
  validPairSetup: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M4]),
      [TlvValue.Proof]: Buffer.from(SRP_TEST_VECTORS.serverProof),
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M4,
      proof: Buffer.from(SRP_TEST_VECTORS.serverProof),
    },
    description: 'Valid M4 pair-setup server proof',
  },

  /** Valid M4 message for pair-verify */
  validPairVerify: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairVerify]),
      [TlvValue.SeqNo]: Buffer.from([State.M4]),
      [TlvValue.EncryptedData]: Buffer.from(Array(64).fill(0xcc)), // Mock encrypted signature
    },
    expectedStructure: {
      method: Method.PairVerify,
      seqNo: State.M4,
      encryptedData: Buffer.from(Array(64).fill(0xcc)),
    },
    description: 'Valid M4 pair-verify server signature',
  },

  /** M4 error response */
  errorResponse: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M4]),
      [TlvValue.Error]: Buffer.from([ErrorCode.Authentication]),
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M4,
      error: ErrorCode.Authentication,
    },
    description: 'M4 error response for invalid client proof',
  },

  /** Invalid M4 messages */
  invalid: {
    missingProof: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M4]),
        // Missing Proof
      },
      description: 'M4 pair-setup missing required Proof',
    },
  },
} as const

/**
 * M5 Message Test Vectors - Client Encrypted Data (Client → Server)
 */
export const M5_MESSAGE_VECTORS = {
  /** Valid M5 message */
  valid: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M5]),
      [TlvValue.EncryptedData]: Buffer.from(Array(80).fill(0xdd)), // Mock encrypted identity + signature
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M5,
      encryptedData: Buffer.from(Array(80).fill(0xdd)),
    },
    description: 'Valid M5 pair-setup client encrypted identity',
  },

  /** Invalid M5 messages */
  invalid: {
    missingEncryptedData: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M5]),
        // Missing EncryptedData
      },
      description: 'M5 missing required EncryptedData',
    },
    emptyEncryptedData: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M5]),
        [TlvValue.EncryptedData]: Buffer.alloc(0), // Empty encrypted data
      },
      description: 'M5 with empty EncryptedData',
    },
  },
} as const

/**
 * M6 Message Test Vectors - Server Encrypted Response (Server → Client)
 */
export const M6_MESSAGE_VECTORS = {
  /** Valid M6 message */
  valid: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M6]),
      [TlvValue.EncryptedData]: Buffer.from(Array(80).fill(0xee)), // Mock encrypted identity + signature
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M6,
      encryptedData: Buffer.from(Array(80).fill(0xee)),
    },
    description: 'Valid M6 pair-setup server encrypted identity',
  },

  /** M6 error response */
  errorResponse: {
    tlvData: {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M6]),
      [TlvValue.Error]: Buffer.from([ErrorCode.Authentication]),
    },
    expectedStructure: {
      method: Method.PairSetup,
      seqNo: State.M6,
      error: ErrorCode.Authentication,
    },
    description: 'M6 error response for invalid client identity',
  },

  /** Invalid M6 messages */
  invalid: {
    missingEncryptedData: {
      tlvData: {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M6]),
        // Missing EncryptedData
      },
      description: 'M6 missing required EncryptedData',
    },
  },
} as const

/**
 * Complete HAP Message Flow Test Vectors
 */
export const HAP_FLOW_VECTORS = {
  /** Successful pair-setup flow */
  pairSetupSuccess: [
    M1_MESSAGE_VECTORS.validMessage,
    M2_MESSAGE_VECTORS.validPairSetup,
    M3_MESSAGE_VECTORS.validPairSetup,
    M4_MESSAGE_VECTORS.validPairSetup,
    M5_MESSAGE_VECTORS.valid,
    M6_MESSAGE_VECTORS.valid,
  ],

  /** Successful pair-verify flow */
  pairVerifySuccess: [
    M1_MESSAGE_VECTORS.pairVerifyM1,
    M2_MESSAGE_VECTORS.validPairVerify,
    M3_MESSAGE_VECTORS.validPairVerify,
    M4_MESSAGE_VECTORS.validPairVerify,
  ],

  /** Authentication failure at M2 */
  authFailureM2: [M1_MESSAGE_VECTORS.validMessage, M2_MESSAGE_VECTORS.errorResponse],

  /** Authentication failure at M4 */
  authFailureM4: [
    M1_MESSAGE_VECTORS.validMessage,
    M2_MESSAGE_VECTORS.validPairSetup,
    M3_MESSAGE_VECTORS.validPairSetup,
    M4_MESSAGE_VECTORS.errorResponse,
  ],

  /** Authentication failure at M6 */
  authFailureM6: [
    M1_MESSAGE_VECTORS.validMessage,
    M2_MESSAGE_VECTORS.validPairSetup,
    M3_MESSAGE_VECTORS.validPairSetup,
    M4_MESSAGE_VECTORS.validPairSetup,
    M5_MESSAGE_VECTORS.valid,
    M6_MESSAGE_VECTORS.errorResponse,
  ],
} as const

/**
 * TLV8 Error Test Vectors for malformed messages
 */
export const TLV8_ERROR_VECTORS = {
  /** Truncated TLV data */
  truncated: {
    /** Only type byte, missing length */
    typeOnly: Buffer.from([TlvValue.Method]),

    /** Type and length, missing value */
    typeAndLength: Buffer.from([TlvValue.Method, 0x01]),

    /** Incomplete value */
    incompleteValue: Buffer.from([TlvValue.Method, 0x02, 0x00]), // Says 2 bytes but only has 1
  },

  /** Invalid TLV structure */
  invalid: {
    /** Empty buffer */
    empty: Buffer.alloc(0),

    /** Invalid type value (>255) - not possible in TLV8 */

    /** Zero-length value when non-zero expected */
    zeroLength: Buffer.from([TlvValue.Method, 0x00]),

    /** Large value fragmentation test (>255 bytes) */
    largeValue: Buffer.concat([
      Buffer.from([TlvValue.PublicKey, 0xff]), // First fragment - 255 bytes
      Buffer.from(Array(255).fill(0xaa)),
      Buffer.from([TlvValue.PublicKey, 0x81]), // Second fragment - 129 bytes
      Buffer.from(Array(129).fill(0xbb)),
    ]),
  },

  /** Duplicate TLV entries (should be merged) */
  duplicates: {
    /** Same type appearing twice */
    sameType: Buffer.concat([
      Buffer.from([TlvValue.Method, 0x01, Method.PairSetup]),
      Buffer.from([TlvValue.Method, 0x01, Method.PairVerify]), // Duplicate - second one wins
    ]),

    /** Fragmented entry */
    fragmented: Buffer.concat([
      Buffer.from([TlvValue.Identifier, 0x05]),
      Buffer.from('Hello', 'utf8'),
      Buffer.from([TlvValue.Identifier, 0x06]),
      Buffer.from(' World', 'utf8'),
    ]), // Should result in "Hello World"
  },
} as const

/**
 * Helper functions for building test messages
 */
export const HapMessageUtils = {
  /**
   * Build a TLV message from test vector
   */
  buildMessage(messageVector: { tlvData: TlvData; description: string }): Buffer {
    return TLV8.encodeObject(messageVector.tlvData)
  },

  /**
   * Build a complete M1 message
   */
  buildM1(method: Method = Method.PairSetup): Buffer {
    return new TlvBuilder().method(method).seqNo(State.M1).build()
  },

  /**
   * Build a complete M2 message for pair-setup
   */
  buildM2PairSetup(salt?: Buffer, serverPublicKey?: Buffer): Buffer {
    return new TlvBuilder()
      .method(Method.PairSetup)
      .seqNo(State.M2)
      .salt(salt || SRP_TEST_VECTORS.salt)
      .publicKey(serverPublicKey || Buffer.from(SRP_TEST_VECTORS.serverPublicKey))
      .build()
  },

  /**
   * Build a complete M3 message for pair-setup
   */
  buildM3PairSetup(clientPublicKey?: Buffer, clientProof?: Buffer): Buffer {
    return new TlvBuilder()
      .method(Method.PairSetup)
      .seqNo(State.M3)
      .publicKey(clientPublicKey || Buffer.from(SRP_TEST_VECTORS.clientPublicKey))
      .proof(clientProof || Buffer.from(SRP_TEST_VECTORS.clientProof))
      .build()
  },

  /**
   * Build a complete M4 message for pair-setup
   */
  buildM4PairSetup(serverProof?: Buffer): Buffer {
    return new TlvBuilder()
      .method(Method.PairSetup)
      .seqNo(State.M4)
      .proof(serverProof || Buffer.from(SRP_TEST_VECTORS.serverProof))
      .build()
  },

  /**
   * Build a complete M5 message
   */
  buildM5(encryptedData?: Buffer): Buffer {
    return new TlvBuilder()
      .method(Method.PairSetup)
      .seqNo(State.M5)
      .encryptedData(encryptedData || Buffer.from(Array(80).fill(0xdd)))
      .build()
  },

  /**
   * Build a complete M6 message
   */
  buildM6(encryptedData?: Buffer): Buffer {
    return new TlvBuilder()
      .method(Method.PairSetup)
      .seqNo(State.M6)
      .encryptedData(encryptedData || Buffer.from(Array(80).fill(0xee)))
      .build()
  },

  /**
   * Build an error message
   */
  buildError(method: Method, seqNo: State, errorCode: ErrorCode): Buffer {
    return new TlvBuilder().method(method).seqNo(seqNo).error(errorCode).build()
  },

  /**
   * Validate message structure against expected structure
   */
  validateMessage(tlvData: TlvData, expected: any): boolean {
    for (const [key, expectedValue] of Object.entries(expected)) {
      const tlvKey = this.getTlvKeyForProperty(key)
      if (!tlvData[tlvKey]) {
        return false
      }

      if (typeof expectedValue === 'number') {
        if (tlvData[tlvKey].readUInt8(0) !== expectedValue) {
          return false
        }
      } else if (Buffer.isBuffer(expectedValue)) {
        if (!tlvData[tlvKey].equals(expectedValue)) {
          return false
        }
      }
    }
    return true
  },

  /**
   * Map property names to TLV keys
   */
  getTlvKeyForProperty(property: string): number {
    const mapping: Record<string, number> = {
      method: TlvValue.Method,
      seqNo: TlvValue.SeqNo,
      salt: TlvValue.Salt,
      publicKey: TlvValue.PublicKey,
      proof: TlvValue.Proof,
      encryptedData: TlvValue.EncryptedData,
      error: TlvValue.Error,
      identifier: TlvValue.Identifier,
      signature: TlvValue.Signature,
      certificate: TlvValue.Certificate,
      permissions: TlvValue.Permissions,
    }
    return mapping[property] || 0
  },
} as const
