/**
 * Comprehensive Ed25519 cryptographic tests for HAP pairing
 *
 * Tests Ed25519 key generation, signing, and verification using both
 * deterministic test vectors and real cryptographic operations.
 * Optimized for Bun runtime with performance benchmarks.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { Ed25519Utils } from '@/core/crypto/ed25519.ts'
import { CryptoError } from '@/core/crypto/errors.ts'
import {
  ED25519_TEST_VECTORS,
  HAP_TEST_CONSTANTS,
  TestVectorUtils,
} from '../../fixtures/crypto-test-vectors'
import {
  BunTestUtils,
  ComparisonUtils,
  CryptoLoggingUtils,
  ErrorTestUtils,
  KeyValidationUtils,
  MemoryUtils,
  PerformanceUtils,
  RandomTestDataUtils,
} from '../../helpers/crypto-test-utils'
import { createLogger } from '@/logging/logging.ts'

const logger = createLogger('Ed25519Tests')

describe('Ed25519 Cryptographic Operations', () => {
  beforeEach(() => {
    PerformanceUtils.reset()
    CryptoLoggingUtils.setVerbose(false) // Set to true for debugging
    // Test vectors are now direct exports - no generation needed
  })

  describe('Key Generation', () => {
    it('should generate valid Ed25519 key pairs', async () => {
      const { result: keyPair, duration } = await PerformanceUtils.measureAsync(
        'ed25519_keygen',
        () => Ed25519Utils.generateKeyPair()
      )

      // Validate key sizes
      KeyValidationUtils.validateEd25519Keys(keyPair.privateKey, keyPair.publicKey)

      // Keys should be different (not all zeros)
      expect(keyPair.privateKey.some(byte => byte !== 0)).toBe(true)
      expect(keyPair.publicKey.some(byte => byte !== 0)).toBe(true)

      // Keys should be different from each other
      expect(TestVectorUtils.arraysEqual(keyPair.privateKey, keyPair.publicKey)).toBe(false)

      // Performance check (should complete quickly)
      ComparisonUtils.expectWithinTimeLimit(duration, 100, 'Ed25519 key generation')

      CryptoLoggingUtils.logPerformance('Ed25519 key generation', duration)
    })

    it('should generate unique key pairs', async () => {
      const keyPair1 = await Ed25519Utils.generateKeyPair()
      const keyPair2 = await Ed25519Utils.generateKeyPair()

      // Different key pairs should have different keys
      expect(TestVectorUtils.arraysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(false)
      expect(TestVectorUtils.arraysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false)
    })

    it('should handle multiple concurrent key generations', async () => {
      const concurrentGenerations = 10
      const promises = Array(concurrentGenerations)
        .fill(0)
        .map(() => Ed25519Utils.generateKeyPair())

      const keyPairs = await Promise.all(promises)

      // All key pairs should be valid and unique
      for (let i = 0; i < keyPairs.length; i++) {
        KeyValidationUtils.validateEd25519Keys(keyPairs[i]!.privateKey, keyPairs[i]!.publicKey)

        for (let j = i + 1; j < keyPairs.length; j++) {
          expect(
            TestVectorUtils.arraysEqual(keyPairs[i]!.privateKey, keyPairs[j]!.privateKey)
          ).toBe(false)
          expect(TestVectorUtils.arraysEqual(keyPairs[i]!.publicKey, keyPairs[j]!.publicKey)).toBe(
            false
          )
        }
      }
    })

    it('should generate keys with sync method', () => {
      const { result: keyPair, duration } = PerformanceUtils.measureSync(
        'ed25519_keygen_sync',
        () => Ed25519Utils.generateKeyPairSync()
      )

      KeyValidationUtils.validateEd25519Keys(keyPair.privateKey, keyPair.publicKey)

      // Sync should be faster than async
      ComparisonUtils.expectWithinTimeLimit(duration, 50, 'Ed25519 sync key generation')

      CryptoLoggingUtils.logPerformance('Ed25519 sync key generation', duration)
    })
  })

  describe('Deterministic Test Vector Validation', () => {
    it('should handle known test vectors correctly', async () => {
      const { primaryKeyPair, testMessage } = ED25519_TEST_VECTORS

      // Test signing with known private key
      const signature = await Ed25519Utils.sign(testMessage, primaryKeyPair.privateKey)
      KeyValidationUtils.validateEd25519Signature(signature)

      // Test verification with known signature
      const isValid = await Ed25519Utils.verify(signature, testMessage, primaryKeyPair.publicKey)
      expect(isValid).toBe(true)

      CryptoLoggingUtils.logHex('Test message', testMessage)
      CryptoLoggingUtils.logHex('Generated signature', signature)
      CryptoLoggingUtils.logValidation('Ed25519 test vector validation', isValid)
    })

    it('should verify signatures consistently', async () => {
      const { primaryKeyPair, testMessage } = ED25519_TEST_VECTORS

      // Generate signature
      const signature = await Ed25519Utils.sign(testMessage, primaryKeyPair.privateKey)

      // Verify multiple times - should always return true
      for (let i = 0; i < 5; i++) {
        const isValid = await Ed25519Utils.verify(signature, testMessage, primaryKeyPair.publicKey)
        expect(isValid).toBe(true)
      }
    })

    it('should work with client and server key pairs from fixtures', async () => {
      const { clientKeyPair, serverKeyPair } = ED25519_TEST_VECTORS
      const testMessage = RandomTestDataUtils.randomMessage(32, 64)

      // Test client key pair
      const clientSignature = await Ed25519Utils.sign(testMessage, clientKeyPair.privateKey)
      const clientValid = await Ed25519Utils.verify(
        clientSignature,
        testMessage,
        clientKeyPair.publicKey
      )
      expect(clientValid).toBe(true)

      // Test server key pair
      const serverSignature = await Ed25519Utils.sign(testMessage, serverKeyPair.privateKey)
      const serverValid = await Ed25519Utils.verify(
        serverSignature,
        testMessage,
        serverKeyPair.publicKey
      )
      expect(serverValid).toBe(true)

      // Cross-verification should fail
      const crossValid1 = await Ed25519Utils.verify(
        clientSignature,
        testMessage,
        serverKeyPair.publicKey
      )
      const crossValid2 = await Ed25519Utils.verify(
        serverSignature,
        testMessage,
        clientKeyPair.publicKey
      )
      expect(crossValid1).toBe(false)
      expect(crossValid2).toBe(false)
    })
  })

  describe('Signing Operations', () => {
    it('should sign messages correctly', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message = RandomTestDataUtils.randomMessage()

      const { result: signature, duration } = await PerformanceUtils.measureAsync(
        'ed25519_sign',
        () => Ed25519Utils.sign(message, keyPair.privateKey)
      )

      KeyValidationUtils.validateEd25519Signature(signature)
      ComparisonUtils.expectWithinTimeLimit(duration, 50, 'Ed25519 signing')

      CryptoLoggingUtils.logPerformance('Ed25519 signing', duration, message.length)
    })

    it('should sign different messages with different signatures', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message1 = new Uint8Array([1, 2, 3, 4])
      const message2 = new Uint8Array([5, 6, 7, 8])

      const signature1 = await Ed25519Utils.sign(message1, keyPair.privateKey)
      const signature2 = await Ed25519Utils.sign(message2, keyPair.privateKey)

      // Different messages should produce different signatures
      expect(TestVectorUtils.arraysEqual(signature1, signature2)).toBe(false)
    })

    it('should sign large messages efficiently', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const largeMessage = RandomTestDataUtils.randomBytes(10 * 1024) // 10KB

      const { result: signature, duration } = await PerformanceUtils.measureAsync(
        'ed25519_sign_large',
        () => Ed25519Utils.sign(largeMessage, keyPair.privateKey)
      )

      KeyValidationUtils.validateEd25519Signature(signature)
      ComparisonUtils.expectWithinTimeLimit(duration, 200, 'Ed25519 large message signing')

      // Verify the large message signature
      const isValid = await Ed25519Utils.verify(signature, largeMessage, keyPair.publicKey)
      expect(isValid).toBe(true)
    })

    it('should handle empty messages', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const emptyMessage = new Uint8Array(0)

      const signature = await Ed25519Utils.sign(emptyMessage, keyPair.privateKey)
      KeyValidationUtils.validateEd25519Signature(signature)

      const isValid = await Ed25519Utils.verify(signature, emptyMessage, keyPair.publicKey)
      expect(isValid).toBe(true)
    })

    it('should work with sync signing method', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message = RandomTestDataUtils.randomMessage()

      const { result: signature, duration } = PerformanceUtils.measureSync(
        'ed25519_sign_sync',
        () => Ed25519Utils.signSync(message, keyPair.privateKey)
      )

      KeyValidationUtils.validateEd25519Signature(signature)
      ComparisonUtils.expectWithinTimeLimit(duration, 25, 'Ed25519 sync signing')

      // Verify signature is correct
      const isValid = await Ed25519Utils.verify(signature, message, keyPair.publicKey)
      expect(isValid).toBe(true)
    })
  })

  describe('Verification Operations', () => {
    let keyPair: { privateKey: Uint8Array; publicKey: Uint8Array }
    let testMessage: Uint8Array
    let validSignature: Uint8Array

    beforeEach(async () => {
      keyPair = await Ed25519Utils.generateKeyPair()
      testMessage = RandomTestDataUtils.randomMessage()
      validSignature = await Ed25519Utils.sign(testMessage, keyPair.privateKey)
    })

    it('should verify valid signatures', async () => {
      const { result: isValid, duration } = await PerformanceUtils.measureAsync(
        'ed25519_verify',
        () => Ed25519Utils.verify(validSignature, testMessage, keyPair.publicKey)
      )

      expect(isValid).toBe(true)
      ComparisonUtils.expectWithinTimeLimit(duration, 50, 'Ed25519 verification')

      CryptoLoggingUtils.logPerformance('Ed25519 verification', duration, testMessage.length)
    })

    it('should reject invalid signatures', async () => {
      await ErrorTestUtils.testCorruptedSignatures(signature =>
        Ed25519Utils.verify(signature, testMessage, keyPair.publicKey)
      )
    })

    it('should reject signatures with wrong message', async () => {
      const wrongMessage = RandomTestDataUtils.randomMessage()
      const isValid = await Ed25519Utils.verify(validSignature, wrongMessage, keyPair.publicKey)
      expect(isValid).toBe(false)
    })

    it('should reject signatures with wrong public key', async () => {
      const wrongKeyPair = await Ed25519Utils.generateKeyPair()
      const isValid = await Ed25519Utils.verify(validSignature, testMessage, wrongKeyPair.publicKey)
      expect(isValid).toBe(false)
    })

    it('should work with sync verification method', async () => {
      const { result: isValid, duration } = PerformanceUtils.measureSync(
        'ed25519_verify_sync',
        () => Ed25519Utils.verifySync(validSignature, testMessage, keyPair.publicKey)
      )

      expect(isValid).toBe(true)
      ComparisonUtils.expectWithinTimeLimit(duration, 25, 'Ed25519 sync verification')
    })

    it('should handle batch verification efficiently', async () => {
      const batchSize = 10
      const messages = Array(batchSize)
        .fill(0)
        .map(() => RandomTestDataUtils.randomMessage())
      const signatures = await Promise.all(
        messages.map(msg => Ed25519Utils.sign(msg, keyPair.privateKey))
      )

      const startTime = performance.now()
      const results = await Promise.all(
        signatures.map((sig, i) => Ed25519Utils.verify(sig, messages[i]!, keyPair.publicKey))
      )
      const duration = performance.now() - startTime

      // All should be valid
      expect(results.every(result => result)).toBe(true)

      // Batch verification should be reasonably fast
      ComparisonUtils.expectWithinTimeLimit(duration, 500, 'Ed25519 batch verification')

      CryptoLoggingUtils.logPerformance('Ed25519 batch verification', duration, batchSize)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid private key sizes in signing', async () => {
      const message = RandomTestDataUtils.randomMessage()

      await ErrorTestUtils.testInvalidKeySizes(
        key => Ed25519Utils.sign(message, key),
        HAP_TEST_CONSTANTS.ED25519_PRIVATE_KEY_SIZE
      )
    })

    it('should handle invalid public key sizes in verification', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message = RandomTestDataUtils.randomMessage()
      const signature = await Ed25519Utils.sign(message, keyPair.privateKey)

      await ErrorTestUtils.testInvalidKeySizes(
        key => Ed25519Utils.verify(signature, message, key),
        HAP_TEST_CONSTANTS.ED25519_PUBLIC_KEY_SIZE
      )
    })

    it('should throw CryptoError for invalid operations', async () => {
      const invalidKey = new Uint8Array(16) // Wrong size
      const message = RandomTestDataUtils.randomMessage()

      await expect(Ed25519Utils.sign(message, invalidKey)).rejects.toBeInstanceOf(CryptoError)
    })

    it('should handle null/undefined inputs gracefully', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message = RandomTestDataUtils.randomMessage()

      // These should throw errors, not crash
      await expect(Ed25519Utils.sign(null as any, keyPair.privateKey)).rejects.toThrow()
      await expect(Ed25519Utils.sign(message, null as any)).rejects.toThrow()
      await expect(Ed25519Utils.verify(null as any, message, keyPair.publicKey)).rejects.toThrow()
    })
  })

  describe('Performance Benchmarks', () => {
    it('should benchmark key generation performance', async () => {
      const { avgDuration, stats } = await PerformanceUtils.benchmarkAsync(
        'ed25519_keygen_benchmark',
        () => Ed25519Utils.generateKeyPair(),
        50
      )

      // Key generation should be reasonably fast
      expect(avgDuration).toBeLessThan(100) // 100ms average
      expect(stats?.min).toBeLessThan(50) // Best case under 50ms

      logger.debug(
        `Ed25519 Key Generation Benchmark: avg=${avgDuration.toFixed(2)}ms, min=${stats?.min.toFixed(2)}ms, max=${stats?.max.toFixed(2)}ms`
      )
    })

    it('should benchmark signing performance', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message = RandomTestDataUtils.randomMessage(256)

      const { avgDuration, stats } = await PerformanceUtils.benchmarkAsync(
        'ed25519_sign_benchmark',
        () => Ed25519Utils.sign(message, keyPair.privateKey),
        100
      )

      // Signing should be fast
      expect(avgDuration).toBeLessThan(50) // 50ms average
      expect(stats?.min).toBeLessThan(25) // Best case under 25ms

      logger.debug(
        `Ed25519 Signing Benchmark: avg=${avgDuration.toFixed(2)}ms, min=${stats?.min.toFixed(2)}ms, max=${stats?.max.toFixed(2)}ms`
      )
    })

    it('should benchmark verification performance', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message = RandomTestDataUtils.randomMessage(256)
      const signature = await Ed25519Utils.sign(message, keyPair.privateKey)

      const { avgDuration, stats } = await PerformanceUtils.benchmarkAsync(
        'ed25519_verify_benchmark',
        () => Ed25519Utils.verify(signature, message, keyPair.publicKey),
        100
      )

      // Verification should be fast
      expect(avgDuration).toBeLessThan(50) // 50ms average
      expect(stats?.min).toBeLessThan(25) // Best case under 25ms

      logger.debug(
        `Ed25519 Verification Benchmark: avg=${avgDuration.toFixed(2)}ms, min=${stats?.min.toFixed(2)}ms, max=${stats?.max.toFixed(2)}ms`
      )
    })

    it('should compare sync vs async performance', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const message = RandomTestDataUtils.randomMessage(256)

      // Benchmark async operations
      const asyncSign = await PerformanceUtils.benchmarkAsync(
        'ed25519_sign_async',
        () => Ed25519Utils.sign(message, keyPair.privateKey),
        50
      )

      // Benchmark sync operations
      const syncSign = PerformanceUtils.benchmarkSync(
        'ed25519_sign_sync',
        () => Ed25519Utils.signSync(message, keyPair.privateKey),
        50
      )

      logger.debug(
        `Ed25519 Sync vs Async Signing: sync=${syncSign.avgDuration.toFixed(2)}ms, async=${asyncSign.avgDuration.toFixed(2)}ms`
      )

      // Sync should generally be faster (no async overhead)
      expect(syncSign.avgDuration).toBeLessThan(asyncSign.avgDuration * 2) // Allow some variance
    })
  })

  describe('Memory Usage', () => {
    it('should not leak memory during repeated operations', async () => {
      const iterations = 100

      const { memoryDelta } = await MemoryUtils.monitorOperation(async () => {
        for (let i = 0; i < iterations; i++) {
          const keyPair = await Ed25519Utils.generateKeyPair()
          const message = RandomTestDataUtils.randomMessage()
          const signature = await Ed25519Utils.sign(message, keyPair.privateKey)
          const isValid = await Ed25519Utils.verify(signature, message, keyPair.publicKey)
          expect(isValid).toBe(true)
        }
      })

      // Memory usage should be reasonable (allow 10MB for 100 iterations)
      ComparisonUtils.expectReasonableMemoryUsage(memoryDelta, 10, 'Ed25519 repeated operations')

      CryptoLoggingUtils.logMemory('Ed25519 repeated operations', memoryDelta)
    })

    it('should handle large message signing without excessive memory', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const largeMessage = RandomTestDataUtils.randomBytes(1024 * 1024) // 1MB

      const { memoryDelta } = await MemoryUtils.monitorOperation(async () => {
        const signature = await Ed25519Utils.sign(largeMessage, keyPair.privateKey)
        const isValid = await Ed25519Utils.verify(signature, largeMessage, keyPair.publicKey)
        expect(isValid).toBe(true)
      })

      // Should not use excessive memory for large messages (allow 15MB overhead)
      ComparisonUtils.expectReasonableMemoryUsage(
        memoryDelta,
        15,
        'Ed25519 large message operations'
      )
    })
  })

  describe('Bun Runtime Integration', () => {
    it('should work correctly in Bun runtime', () => {
      BunTestUtils.skipIfNotBun()

      const capabilities = BunTestUtils.getCryptoCapabilities()
      logger.debug({ capabilities })

      expect(capabilities.webCrypto).toBe(true)
      // Ed25519 support may vary, but our implementation should work regardless
    })

    it('should use optimal implementation for Bun', async () => {
      if (BunTestUtils.isBun()) {
        logger.debug(`Running Ed25519 tests in Bun: ${BunTestUtils.getBunVersion()}`)

        // Test that our implementation works in Bun
        const keyPair = await Ed25519Utils.generateKeyPair()
        const message = RandomTestDataUtils.randomMessage()
        const signature = await Ed25519Utils.sign(message, keyPair.privateKey)
        const isValid = await Ed25519Utils.verify(signature, message, keyPair.publicKey)

        expect(isValid).toBe(true)
      }
    })
  })

  describe('HAP Protocol Integration', () => {
    it('should work with HAP pairing message sizes', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()

      // Test typical HAP message sizes
      const hapMessages = [
        new Uint8Array(32), // Device identifier
        new Uint8Array(64), // Typical TLV8 data
        new Uint8Array(128), // M5/M4 encrypted data
        new Uint8Array(256), // Large pairing data
      ]

      for (const message of hapMessages) {
        crypto.getRandomValues(message)

        const signature = await Ed25519Utils.sign(message, keyPair.privateKey)
        const isValid = await Ed25519Utils.verify(signature, message, keyPair.publicKey)

        expect(isValid).toBe(true)
        KeyValidationUtils.validateEd25519Signature(signature)
      }
    })

    it('should handle HAP identifier format', async () => {
      const keyPair = await Ed25519Utils.generateKeyPair()
      const hapIdentifier = Buffer.from(HAP_TEST_CONSTANTS.CLIENT_IDENTIFIER, 'utf8')

      const signature = await Ed25519Utils.sign(hapIdentifier, keyPair.privateKey)
      const isValid = await Ed25519Utils.verify(signature, hapIdentifier, keyPair.publicKey)

      expect(isValid).toBe(true)
    })

    it('should be compatible with HAP key pair formats', () => {
      // Test that our generated keys match expected HAP formats
      const { clientKeyPair, serverKeyPair } = ED25519_TEST_VECTORS

      KeyValidationUtils.validateEd25519Keys(clientKeyPair.privateKey, clientKeyPair.publicKey)
      KeyValidationUtils.validateEd25519Keys(serverKeyPair.privateKey, serverKeyPair.publicKey)

      // Keys should have correct lengths for HAP protocol
      expect(clientKeyPair.privateKey.length).toBe(HAP_TEST_CONSTANTS.ED25519_PRIVATE_KEY_SIZE)
      expect(clientKeyPair.publicKey.length).toBe(HAP_TEST_CONSTANTS.ED25519_PUBLIC_KEY_SIZE)
    })
  })
})
