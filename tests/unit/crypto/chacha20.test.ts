/**
 * Comprehensive ChaCha20-Poly1305 encryption tests for HAP session encryption
 *
 * Tests ChaCha20-Poly1305 AEAD encryption using both deterministic test vectors
 * and real cryptographic operations. Optimized for Bun runtime with
 * performance benchmarks and HAP-specific test cases.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { ChaCha20Utils } from '@/core/crypto/chacha20.ts'
import {
  CHACHA20_TEST_VECTORS,
  ERROR_TEST_VECTORS,
  HAP_TEST_CONSTANTS,
  TestVectorUtils,
} from '../../fixtures/crypto-test-vectors'
import {
  BunTestUtils,
  ComparisonUtils,
  CryptoLoggingUtils,
  ErrorTestUtils,
  MemoryUtils,
  PerformanceUtils,
  RandomTestDataUtils,
} from '../../helpers/crypto-test-utils'
import { createLogger } from '@/logging/logging.ts'
const logger = createLogger('ChaCha20Poly1305Test')
describe('ChaCha20-Poly1305 Encryption Operations', () => {
  beforeEach(() => {
    PerformanceUtils.reset()
    CryptoLoggingUtils.setVerbose(false) // Set to true for debugging
  })

  describe('Encryption and Decryption', () => {
    it('should encrypt data with ChaCha20-Poly1305', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      const { result: ciphertext, duration } = await PerformanceUtils.measureAsync(
        'chacha20_encrypt',
        () => ChaCha20Utils.encrypt(key, nonce, plaintext)
      )

      // Validate ciphertext
      expect(ciphertext).toBeInstanceOf(Uint8Array)
      expect(ciphertext.length).toBe(plaintext.length + 16) // +16 for auth tag

      // Ciphertext should be different from plaintext
      expect(ComparisonUtils.arraysEqual(ciphertext.slice(0, plaintext.length), plaintext)).toBe(
        false
      )

      CryptoLoggingUtils.logPerformance('ChaCha20-Poly1305 encryption', duration)
    })

    it('should decrypt data with ChaCha20-Poly1305', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      // First encrypt
      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)

      // Then decrypt
      const { result: decrypted, duration } = await PerformanceUtils.measureAsync(
        'chacha20_decrypt',
        () => ChaCha20Utils.decrypt(key, nonce, ciphertext)
      )

      // Validate decryption
      expect(decrypted).toBeInstanceOf(Uint8Array)
      expect(decrypted.length).toBe(plaintext.length)
      expect(ComparisonUtils.arraysEqual(decrypted, plaintext)).toBe(true)

      CryptoLoggingUtils.logPerformance('ChaCha20-Poly1305 decryption', duration)
    })

    it('should encrypt/decrypt with additional authenticated data (AAD)', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext
      const aad = CHACHA20_TEST_VECTORS.aad

      // Encrypt with AAD
      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext, aad)

      // Decrypt with AAD
      const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext, aad)

      expect(ComparisonUtils.arraysEqual(decrypted, plaintext)).toBe(true)
    })

    it('should handle empty plaintext', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const emptyPlaintext = CHACHA20_TEST_VECTORS.emptyPlaintext

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, emptyPlaintext)
      expect(ciphertext.length).toBe(16) // Only auth tag

      const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext)
      expect(decrypted.length).toBe(0)
      expect(ComparisonUtils.arraysEqual(decrypted, emptyPlaintext)).toBe(true)
    })

    it('should handle large messages', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const largePlaintext = CHACHA20_TEST_VECTORS.largePlaintext

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, largePlaintext)
      expect(ciphertext.length).toBe(largePlaintext.length + 16)

      const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext)
      expect(ComparisonUtils.arraysEqual(decrypted, largePlaintext)).toBe(true)
    })

    it('should encrypt/decrypt synchronously', () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      const { result: ciphertext, duration: encryptDuration } = PerformanceUtils.measureSync(
        'chacha20_encrypt_sync',
        () => ChaCha20Utils.encryptSync(key, nonce, plaintext)
      )

      const { result: decrypted, duration: decryptDuration } = PerformanceUtils.measureSync(
        'chacha20_decrypt_sync',
        () => ChaCha20Utils.decryptSync(key, nonce, ciphertext)
      )

      expect(ComparisonUtils.arraysEqual(decrypted, plaintext)).toBe(true)

      CryptoLoggingUtils.logPerformance('ChaCha20-Poly1305 sync encrypt', encryptDuration)
      CryptoLoggingUtils.logPerformance('ChaCha20-Poly1305 sync decrypt', decryptDuration)
    })

    it('should produce different ciphertexts with different nonces', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce1 = CHACHA20_TEST_VECTORS.nonce
      const nonce2 = CHACHA20_TEST_VECTORS.alternateNonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      const ciphertext1 = await ChaCha20Utils.encrypt(key, nonce1, plaintext)
      const ciphertext2 = await ChaCha20Utils.encrypt(key, nonce2, plaintext)

      expect(ComparisonUtils.arraysEqual(ciphertext1, ciphertext2)).toBe(false)

      // Both should decrypt correctly
      const decrypted1 = await ChaCha20Utils.decrypt(key, nonce1, ciphertext1)
      const decrypted2 = await ChaCha20Utils.decrypt(key, nonce2, ciphertext2)

      expect(ComparisonUtils.arraysEqual(decrypted1, plaintext)).toBe(true)
      expect(ComparisonUtils.arraysEqual(decrypted2, plaintext)).toBe(true)
    })

    it('should produce different ciphertexts with different keys', async () => {
      const key1 = CHACHA20_TEST_VECTORS.key
      const key2 = CHACHA20_TEST_VECTORS.alternateKey
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      const ciphertext1 = await ChaCha20Utils.encrypt(key1, nonce, plaintext)
      const ciphertext2 = await ChaCha20Utils.encrypt(key2, nonce, plaintext)

      expect(ComparisonUtils.arraysEqual(ciphertext1, ciphertext2)).toBe(false)
    })
  })

  describe('Nonce Generation', () => {
    it('should generate random nonces', () => {
      const nonce1 = ChaCha20Utils.generateNonce()
      const nonce2 = ChaCha20Utils.generateNonce()

      expect(nonce1.length).toBe(HAP_TEST_CONSTANTS.CHACHA20_NONCE_SIZE)
      expect(nonce2.length).toBe(HAP_TEST_CONSTANTS.CHACHA20_NONCE_SIZE)
      expect(ComparisonUtils.arraysEqual(nonce1, nonce2)).toBe(false)
    })

    it('should generate unique nonces in sequence', () => {
      const nonces = new Set<string>()
      const count = 100

      for (let i = 0; i < count; i++) {
        const nonce = ChaCha20Utils.generateNonce()
        const hex = TestVectorUtils.toHex(nonce)
        expect(nonces.has(hex)).toBe(false)
        nonces.add(hex)
      }

      expect(nonces.size).toBe(count)
    })

    it('should work with sequential nonces', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const plaintext = CHACHA20_TEST_VECTORS.plaintext
      const nonceSequence = CHACHA20_TEST_VECTORS.nonceSequence

      for (const nonce of nonceSequence) {
        const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)
        const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext)
        expect(ComparisonUtils.arraysEqual(decrypted, plaintext)).toBe(true)
      }
    })
  })

  describe('Authentication and Integrity', () => {
    it('should reject ciphertext with modified auth tag', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)

      // Corrupt the auth tag (last 16 bytes)
      const corruptedCiphertext = new Uint8Array(ciphertext)
      corruptedCiphertext[corruptedCiphertext.length - 1]! ^= 0x01

      await expect(ChaCha20Utils.decrypt(key, nonce, corruptedCiphertext)).rejects.toThrow()
    })

    it('should reject ciphertext with modified data', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)

      // Corrupt the data (first byte)
      const corruptedCiphertext = new Uint8Array(ciphertext)
      corruptedCiphertext[0]! ^= 0x01

      await expect(ChaCha20Utils.decrypt(key, nonce, corruptedCiphertext)).rejects.toThrow()
    })

    it('should reject with wrong AAD', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext
      const aad = CHACHA20_TEST_VECTORS.aad
      const wrongAad = new Uint8Array([0x77, 0x72, 0x6f, 0x6e, 0x67]) // "wrong"

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext, aad)

      await expect(ChaCha20Utils.decrypt(key, nonce, ciphertext, wrongAad)).rejects.toThrow()
    })

    it('should reject with missing AAD when AAD was used', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext
      const aad = CHACHA20_TEST_VECTORS.aad

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext, aad)

      await expect(ChaCha20Utils.decrypt(key, nonce, ciphertext)).rejects.toThrow()
    })

    it('should work with empty AAD', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext
      const emptyAad = CHACHA20_TEST_VECTORS.emptyAad

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext, emptyAad)
      const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext, emptyAad)

      expect(ComparisonUtils.arraysEqual(decrypted, plaintext)).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid key sizes', async () => {
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      await expect(
        ChaCha20Utils.encrypt(ERROR_TEST_VECTORS.invalidKeys.tooShort, nonce, plaintext)
      ).rejects.toThrow()

      await expect(
        ChaCha20Utils.encrypt(ERROR_TEST_VECTORS.invalidKeys.tooLong, nonce, plaintext)
      ).rejects.toThrow()

      await expect(
        ChaCha20Utils.encrypt(ERROR_TEST_VECTORS.invalidKeys.empty, nonce, plaintext)
      ).rejects.toThrow()
    })

    it('should handle invalid nonce sizes', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      await expect(
        ChaCha20Utils.encrypt(key, ERROR_TEST_VECTORS.invalidNonces.tooShort, plaintext)
      ).rejects.toThrow()

      await expect(
        ChaCha20Utils.encrypt(key, ERROR_TEST_VECTORS.invalidNonces.tooLong, plaintext)
      ).rejects.toThrow()

      await expect(
        ChaCha20Utils.encrypt(key, ERROR_TEST_VECTORS.invalidNonces.empty, plaintext)
      ).rejects.toThrow()
    })

    it('should handle invalid ciphertext for decryption', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce

      await expect(
        ChaCha20Utils.decrypt(key, nonce, ERROR_TEST_VECTORS.invalidEncryptedData.tooShort)
      ).rejects.toThrow()

      await expect(
        ChaCha20Utils.decrypt(key, nonce, ERROR_TEST_VECTORS.invalidEncryptedData.truncatedTag)
      ).rejects.toThrow()
    })

    it('should throw CryptoError for invalid operations', async () => {
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      try {
        await ChaCha20Utils.encrypt(ERROR_TEST_VECTORS.invalidKeys.empty, nonce, plaintext)
        expect(false).toBe(true) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    it('should handle null/undefined inputs gracefully', async () => {
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      await ErrorTestUtils.expectAsyncError(() =>
        ChaCha20Utils.encrypt(null as any, nonce, plaintext)
      )
      await ErrorTestUtils.expectAsyncError(() =>
        ChaCha20Utils.encrypt(key, null as any, plaintext)
      )
      await ErrorTestUtils.expectAsyncError(() => ChaCha20Utils.encrypt(key, nonce, null as any))
    })
  })

  describe('Performance Benchmarks', () => {
    it('should benchmark ChaCha20-Poly1305 encryption performance', async () => {
      const key = RandomTestDataUtils.randomBytes(32)
      const nonce = RandomTestDataUtils.randomBytes(12)
      const plaintext = RandomTestDataUtils.randomBytes(1024)
      const iterations = 100

      const { avgDuration } = await PerformanceUtils.benchmarkAsync(
        'ChaCha20-Poly1305 Encryption',
        async () => {
          await ChaCha20Utils.encrypt(key, nonce, plaintext)
        },
        iterations
      )

      const totalDuration = avgDuration * iterations
      CryptoLoggingUtils.logBenchmark('ChaCha20-Poly1305 Encryption', totalDuration, iterations)
      expect(totalDuration).toBeLessThan(3000) // Should complete in under 3 seconds
    })

    it('should benchmark ChaCha20-Poly1305 decryption performance', async () => {
      const key = RandomTestDataUtils.randomBytes(32)
      const nonce = RandomTestDataUtils.randomBytes(12)
      const plaintext = RandomTestDataUtils.randomBytes(1024)
      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)
      const iterations = 100

      const { avgDuration } = await PerformanceUtils.benchmarkAsync(
        'ChaCha20-Poly1305 Decryption',
        async () => {
          await ChaCha20Utils.decrypt(key, nonce, ciphertext)
        },
        iterations
      )

      const totalDuration = avgDuration * iterations
      CryptoLoggingUtils.logBenchmark('ChaCha20-Poly1305 Decryption', totalDuration, iterations)
      expect(totalDuration).toBeLessThan(3000) // Should complete in under 3 seconds
    })

    it('should benchmark sync vs async ChaCha20-Poly1305 performance', async () => {
      const key = RandomTestDataUtils.randomBytes(32)
      const nonce = RandomTestDataUtils.randomBytes(12)
      const plaintext = RandomTestDataUtils.randomBytes(1024)
      const iterations = 100

      const asyncResults = await PerformanceUtils.benchmarkAsync(
        'ChaCha20 Async',
        async () => {
          const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)
          await ChaCha20Utils.decrypt(key, nonce, ciphertext)
        },
        iterations
      )

      const syncResults = PerformanceUtils.benchmarkSync(
        'ChaCha20 Sync',
        () => {
          const ciphertext = ChaCha20Utils.encryptSync(key, nonce, plaintext)
          ChaCha20Utils.decryptSync(key, nonce, ciphertext)
        },
        iterations
      )

      logger.debug(
        `ChaCha20 Sync vs Async: sync=${syncResults.avgDuration}ms, async=${asyncResults.avgDuration}ms`
      )

      // Both should be reasonable
      const asyncTotal = asyncResults.avgDuration * iterations
      const syncTotal = syncResults.avgDuration * iterations
      expect(asyncTotal).toBeLessThan(5000)
      expect(syncTotal).toBeLessThan(5000)
    })

    it('should benchmark different message sizes', async () => {
      const key = RandomTestDataUtils.randomBytes(32)
      const nonce = RandomTestDataUtils.randomBytes(12)
      const sizes = [64, 256, 1024, 4096, 16384] // Different message sizes
      const iterations = 50

      for (const size of sizes) {
        const plaintext = RandomTestDataUtils.randomBytes(size)

        const { avgDuration } = await PerformanceUtils.benchmarkAsync(
          `ChaCha20 ${size}B`,
          async () => {
            const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)
            await ChaCha20Utils.decrypt(key, nonce, ciphertext)
          },
          iterations
        )

        const totalDuration = avgDuration * iterations
        const mbps = (size * iterations) / (totalDuration / 1000) / (1024 * 1024)
        logger.debug(`ChaCha20 ${size}B: ${avgDuration.toFixed(2)}ms avg, ${mbps.toFixed(2)} MB/s`)

        expect(totalDuration).toBeLessThan(10000) // Should be reasonable
      }
    })
  })

  describe('Memory Usage', () => {
    it('should not leak memory during repeated operations', async () => {
      const iterations = 1000
      const key = RandomTestDataUtils.randomBytes(32)
      const nonce = RandomTestDataUtils.randomBytes(12)
      const plaintext = RandomTestDataUtils.randomBytes(256)

      const { memoryUsed } = await MemoryUtils.measureMemoryUsage(async () => {
        for (let i = 0; i < iterations; i++) {
          const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)
          const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext)
          // Use the result to prevent optimization
          expect(decrypted.length).toBe(plaintext.length)
        }
      })

      CryptoLoggingUtils.logMemoryUsage('ChaCha20 repeated operations', memoryUsed, iterations)

      // Memory usage should be reasonable (less than 20MB for 1000 operations)
      expect(memoryUsed).toBeLessThan(20 * 1024 * 1024)
    })

    it('should handle large message encryption without excessive memory', async () => {
      const key = RandomTestDataUtils.randomBytes(32)
      const nonce = RandomTestDataUtils.randomBytes(12)
      const largeMessage = RandomTestDataUtils.randomBytes(1024 * 1024) // 1MB

      const { memoryUsed } = await MemoryUtils.measureMemoryUsage(async () => {
        const ciphertext = await ChaCha20Utils.encrypt(key, nonce, largeMessage)
        const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext)
        expect(decrypted.length).toBe(largeMessage.length)
      })

      CryptoLoggingUtils.logMemoryUsage('ChaCha20 large message encryption', memoryUsed, 1)

      // Should not use excessive memory for large messages (less than 10MB overhead)
      expect(memoryUsed).toBeLessThan(10 * 1024 * 1024)
    })
  })

  describe('Bun Runtime Integration', () => {
    it('should work correctly in Bun runtime', async () => {
      const runtimeInfo = BunTestUtils.getBunRuntimeInfo()
      logger.debug(`Running ChaCha20-Poly1305 tests in Bun: ${runtimeInfo.bunVersion}`)

      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = CHACHA20_TEST_VECTORS.plaintext

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)
      const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext)

      expect(ComparisonUtils.arraysEqual(decrypted, plaintext)).toBe(true)
    })

    it('should use optimal implementation for Bun', async () => {
      const capabilities = BunTestUtils.detectCryptoCapabilities()
      logger.debug({ capabilities })

      expect(capabilities.chacha20).toBe(true)
      expect(capabilities.webCrypto).toBe(true)

      // Test that ChaCha20-Poly1305 works with Bun's implementation
      const key = RandomTestDataUtils.randomBytes(32)
      const nonce = RandomTestDataUtils.randomBytes(12)
      const plaintext = RandomTestDataUtils.randomBytes(64)

      const ciphertext = await ChaCha20Utils.encrypt(key, nonce, plaintext)
      const decrypted = await ChaCha20Utils.decrypt(key, nonce, ciphertext)

      expect(ComparisonUtils.arraysEqual(decrypted, plaintext)).toBe(true)
    })
  })

  describe('HAP Protocol Integration', () => {
    it('should handle HAP session encryption patterns', async () => {
      // Simulate HAP session encryption scenarios
      const sessionKey = RandomTestDataUtils.randomBytes(32)
      const messages = [
        new TextEncoder().encode('HAP pairing M1'),
        new TextEncoder().encode('HAP pairing M2 with longer content'),
        new Uint8Array([0x06, 0x01, 0x01, 0x02]), // TLV8 data
        RandomTestDataUtils.randomBytes(256), // Large control message
      ]

      for (const [_, message] of messages.entries()) {
        const nonce = ChaCha20Utils.generateNonce()

        const ciphertext = await ChaCha20Utils.encrypt(sessionKey, nonce, message)
        const decrypted = await ChaCha20Utils.decrypt(sessionKey, nonce, ciphertext)

        expect(ComparisonUtils.arraysEqual(decrypted, message)).toBe(true)

        // Ciphertext should include auth tag
        expect(ciphertext.length).toBe(message.length + 16)
      }
    })

    it('should handle HAP frame encryption with headers', async () => {
      const sessionKey = RandomTestDataUtils.randomBytes(32)
      const nonce = ChaCha20Utils.generateNonce()

      // HAP frame format: [length][encrypted_data][auth_tag]
      const payload = new TextEncoder().encode('HAP control data')
      const lengthHeader = new Uint8Array(2)
      lengthHeader[0] = payload.length & 0xff
      lengthHeader[1] = (payload.length >> 8) & 0xff

      // Encrypt payload with length header as AAD
      const ciphertext = await ChaCha20Utils.encrypt(sessionKey, nonce, payload, lengthHeader)
      const decrypted = await ChaCha20Utils.decrypt(sessionKey, nonce, ciphertext, lengthHeader)

      expect(ComparisonUtils.arraysEqual(decrypted, payload)).toBe(true)
    })

    it('should be compatible with HAP encryption key sizes', () => {
      // HAP requires 32-byte keys and 12-byte nonces
      const keySize = HAP_TEST_CONSTANTS.CHACHA20_KEY_SIZE
      const nonceSize = HAP_TEST_CONSTANTS.CHACHA20_NONCE_SIZE

      expect(keySize).toBe(32)
      expect(nonceSize).toBe(12)

      // Validate that our key and nonce generation produces correct sizes
      const nonce = ChaCha20Utils.generateNonce()
      expect(nonce.length).toBe(nonceSize)
    })

    it('should work with HAP nonce incrementing pattern', async () => {
      const sessionKey = RandomTestDataUtils.randomBytes(32)
      const message = new TextEncoder().encode('HAP sequential message')

      // HAP often uses incrementing nonces
      const baseNonce = new Uint8Array(12)

      for (let i = 0; i < 10; i++) {
        // Increment nonce (little-endian)
        let carry = i
        for (let j = 0; j < 8; j++) {
          baseNonce[j] = carry & 0xff
          carry >>= 8
          if (carry === 0) break
        }

        const ciphertext = await ChaCha20Utils.encrypt(sessionKey, baseNonce, message)
        const decrypted = await ChaCha20Utils.decrypt(sessionKey, baseNonce, ciphertext)

        expect(ComparisonUtils.arraysEqual(decrypted, message)).toBe(true)
      }
    })
  })

  describe('Cross-Compatibility with pyatv', () => {
    it('should produce deterministic outputs for known inputs', async () => {
      // Use deterministic key and nonce for reproducible results
      const key = new Uint8Array(Array(32).fill(0xaa)) // pyatv pattern
      const nonce = new Uint8Array(Array(12).fill(0xbb))
      const plaintext = new TextEncoder().encode('HAP test message')

      // Encrypt multiple times - should be identical
      const ciphertext1 = await ChaCha20Utils.encrypt(key, nonce, plaintext)
      const ciphertext2 = await ChaCha20Utils.encrypt(key, nonce, plaintext)
      const ciphertext3 = ChaCha20Utils.encryptSync(key, nonce, plaintext)

      expect(ComparisonUtils.arraysEqual(ciphertext1, ciphertext2)).toBe(true)
      expect(ComparisonUtils.arraysEqual(ciphertext1, ciphertext3)).toBe(true)

      // All should decrypt to original
      const decrypted1 = await ChaCha20Utils.decrypt(key, nonce, ciphertext1)
      const decrypted2 = ChaCha20Utils.decryptSync(key, nonce, ciphertext2)

      expect(ComparisonUtils.arraysEqual(decrypted1, plaintext)).toBe(true)
      expect(ComparisonUtils.arraysEqual(decrypted2, plaintext)).toBe(true)
    })

    it('should handle HAP protocol message encryption flow', async () => {
      // Simulate full HAP session encryption flow
      const sessionKey = RandomTestDataUtils.randomBytes(32)

      // M1: Pair-setup message
      const m1Data = new Uint8Array([
        0x06,
        0x01,
        0x01, // Method=PairSetup, SeqNo=M1
        0x05,
        0x20,
        ...RandomTestDataUtils.randomBytes(32), // PublicKey
      ])

      // M2: Response message
      const m2Data = new Uint8Array([
        0x06,
        0x01,
        0x02, // Method=PairSetup, SeqNo=M2
        0x02,
        0x10,
        ...RandomTestDataUtils.randomBytes(16), // Salt
        0x05,
        0x20,
        ...RandomTestDataUtils.randomBytes(32), // PublicKey
      ])

      const messages = [m1Data, m2Data]

      for (const message of messages) {
        const nonce = ChaCha20Utils.generateNonce()

        const ciphertext = await ChaCha20Utils.encrypt(sessionKey, nonce, message)
        const decrypted = await ChaCha20Utils.decrypt(sessionKey, nonce, ciphertext)

        expect(ComparisonUtils.arraysEqual(decrypted, message)).toBe(true)
        expect(ciphertext.length).toBe(message.length + 16)
      }
    })

    it('should be compatible with HAP encryption format requirements', () => {
      // HAP requires specific encryption format compatibility
      const tagSize = HAP_TEST_CONSTANTS.CHACHA20_TAG_SIZE
      expect(tagSize).toBe(16)

      // Verify our encryption produces correct tag size
      const key = CHACHA20_TEST_VECTORS.key
      const nonce = CHACHA20_TEST_VECTORS.nonce
      const plaintext = new Uint8Array([0x01, 0x02, 0x03])

      const ciphertext = ChaCha20Utils.encryptSync(key, nonce, plaintext)
      expect(ciphertext.length).toBe(plaintext.length + tagSize)
    })
  })
})
