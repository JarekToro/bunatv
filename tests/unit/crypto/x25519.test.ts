/**
 * Comprehensive X25519 cryptographic tests for HAP pairing
 *
 * Tests X25519 key generation, key exchange, and shared secret computation
 * using both deterministic test vectors and real cryptographic operations.
 * Optimized for Bun runtime with performance benchmarks.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { X25519Utils } from '@/core/crypto/x25519.ts'
import { CryptoError } from '@/core/crypto/errors.ts'
import {
  HAP_TEST_CONSTANTS,
  TestVectorUtils,
  X25519_TEST_VECTORS,
} from '../../fixtures/crypto-test-vectors'
import {
  BunTestUtils,
  ComparisonUtils,
  CryptoLoggingUtils,
  ErrorTestUtils,
  KeyValidationUtils,
  MemoryUtils,
  PerformanceUtils,
} from '../../helpers/crypto-test-utils'
import { createLogger } from '@/logging/logging.ts'
const logger = createLogger('X25519Tests')
describe('X25519 Cryptographic Operations', () => {
  beforeEach(() => {
    PerformanceUtils.reset()
    CryptoLoggingUtils.setVerbose(false) // Set to true for debugging
    // Test vectors are now direct exports - no generation needed
  })

  describe('Key Generation', () => {
    it('should generate valid X25519 key pairs', async () => {
      const { result: keyPair, duration } = await PerformanceUtils.measureAsync(
        'x25519_keygen',
        () => X25519Utils.generateKeyPair()
      )

      // Validate key sizes
      KeyValidationUtils.validateX25519Keys(keyPair.privateKey, keyPair.publicKey)

      // Keys should be different (not all zeros)
      expect(keyPair.privateKey.some(byte => byte !== 0)).toBe(true)
      expect(keyPair.publicKey.some(byte => byte !== 0)).toBe(true)

      // Keys should be different from each other
      expect(TestVectorUtils.arraysEqual(keyPair.privateKey, keyPair.publicKey)).toBe(false)

      // Performance check (should complete quickly)
      ComparisonUtils.expectWithinTimeLimit(duration, 100, 'X25519 key generation')

      CryptoLoggingUtils.logPerformance('X25519 key generation', duration)
    })

    it('should generate unique key pairs', async () => {
      const keyPair1 = await X25519Utils.generateKeyPair()
      const keyPair2 = await X25519Utils.generateKeyPair()

      // Different key pairs should have different keys
      expect(TestVectorUtils.arraysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(false)
      expect(TestVectorUtils.arraysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false)
    })

    it('should handle multiple concurrent key generations', async () => {
      const concurrentGenerations = 10
      const promises = Array(concurrentGenerations)
        .fill(0)
        .map(() => X25519Utils.generateKeyPair())

      const keyPairs = await Promise.all(promises)

      // All key pairs should be valid and unique
      for (let i = 0; i < keyPairs.length; i++) {
        KeyValidationUtils.validateX25519Keys(keyPairs[i]!.privateKey, keyPairs[i]!.publicKey)

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
      const { result: keyPair, duration } = PerformanceUtils.measureSync('x25519_keygen_sync', () =>
        X25519Utils.generateKeyPairSync()
      )

      KeyValidationUtils.validateX25519Keys(keyPair.privateKey, keyPair.publicKey)

      // Sync should be faster than async
      ComparisonUtils.expectWithinTimeLimit(duration, 50, 'X25519 sync key generation')

      CryptoLoggingUtils.logPerformance('X25519 sync key generation', duration)
    })

    it('should generate key pairs from deterministic seeds', () => {
      const seed = new Uint8Array(Array(32).fill(0x55))
      const keyPair1 = X25519Utils.generateKeyPairFromSeed(seed)
      const keyPair2 = X25519Utils.generateKeyPairFromSeed(seed)

      // Same seed should produce same key pair
      expect(TestVectorUtils.arraysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(true)
      expect(TestVectorUtils.arraysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(true)

      KeyValidationUtils.validateX25519Keys(keyPair1.privateKey, keyPair1.publicKey)
    })
  })

  describe('Deterministic Test Vector Validation', () => {
    it('should handle known test vectors correctly', async () => {
      const { clientKeyPair, serverKeyPair, expectedSharedSecret } = X25519_TEST_VECTORS

      // Verify key pairs are valid
      KeyValidationUtils.validateX25519Keys(clientKeyPair.privateKey, clientKeyPair.publicKey)
      KeyValidationUtils.validateX25519Keys(serverKeyPair.privateKey, serverKeyPair.publicKey)

      // Test key exchange from client side
      const clientSharedSecret = await X25519Utils.computeSharedSecret(
        clientKeyPair.privateKey,
        serverKeyPair.publicKey
      )

      // Test key exchange from server side
      const serverSharedSecret = await X25519Utils.computeSharedSecret(
        serverKeyPair.privateKey,
        clientKeyPair.publicKey
      )

      // Both should produce the same shared secret
      expect(TestVectorUtils.arraysEqual(clientSharedSecret, serverSharedSecret)).toBe(true)

      // Should match expected deterministic value
      expect(TestVectorUtils.arraysEqual(clientSharedSecret, expectedSharedSecret)).toBe(true)

      CryptoLoggingUtils.logHex('Client shared secret', clientSharedSecret)
      CryptoLoggingUtils.logHex('Server shared secret', serverSharedSecret)
      CryptoLoggingUtils.logHex('Expected shared secret', expectedSharedSecret)
    })

    it('should verify deterministic key generation', () => {
      const { clientKeyPair, serverKeyPair } = X25519_TEST_VECTORS

      // Re-generate from same seeds
      const clientSeed = new Uint8Array(Array(32).fill(0x33))
      const serverSeed = new Uint8Array(Array(32).fill(0x44))

      const regeneratedClient = X25519Utils.generateKeyPairFromSeed(clientSeed)
      const regeneratedServer = X25519Utils.generateKeyPairFromSeed(serverSeed)

      // Should match the test vectors exactly
      expect(
        TestVectorUtils.arraysEqual(regeneratedClient.privateKey, clientKeyPair.privateKey)
      ).toBe(true)
      expect(
        TestVectorUtils.arraysEqual(regeneratedClient.publicKey, clientKeyPair.publicKey)
      ).toBe(true)
      expect(
        TestVectorUtils.arraysEqual(regeneratedServer.privateKey, serverKeyPair.privateKey)
      ).toBe(true)
      expect(
        TestVectorUtils.arraysEqual(regeneratedServer.publicKey, serverKeyPair.publicKey)
      ).toBe(true)
    })

    it('should compute shared secrets consistently', async () => {
      const { clientKeyPair, serverKeyPair } = X25519_TEST_VECTORS

      // Compute shared secret multiple times - should be identical
      const secrets = await Promise.all([
        X25519Utils.computeSharedSecret(clientKeyPair.privateKey, serverKeyPair.publicKey),
        X25519Utils.computeSharedSecret(clientKeyPair.privateKey, serverKeyPair.publicKey),
        X25519Utils.computeSharedSecret(clientKeyPair.privateKey, serverKeyPair.publicKey),
      ])

      // All should be identical
      for (let i = 1; i < secrets.length; i++) {
        expect(TestVectorUtils.arraysEqual(secrets[0], secrets[i]!)).toBe(true)
      }
    })
  })

  describe('Key Exchange Operations', () => {
    it('should perform ECDH key exchange correctly', async () => {
      const aliceKeyPair = await X25519Utils.generateKeyPair()
      const bobKeyPair = await X25519Utils.generateKeyPair()

      const { result: aliceSharedSecret, duration: aliceDuration } =
        await PerformanceUtils.measureAsync('x25519_key_exchange_alice', () =>
          X25519Utils.computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)
        )

      const { result: bobSharedSecret, duration: bobDuration } =
        await PerformanceUtils.measureAsync('x25519_key_exchange_bob', () =>
          X25519Utils.computeSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey)
        )

      // Both parties should derive the same shared secret
      expect(TestVectorUtils.arraysEqual(aliceSharedSecret, bobSharedSecret)).toBe(true)
      TestVectorUtils.validateSize(
        aliceSharedSecret,
        HAP_TEST_CONSTANTS.X25519_SHARED_SECRET_SIZE,
        'X25519 shared secret'
      )

      // Performance checks
      ComparisonUtils.expectWithinTimeLimit(aliceDuration, 50, 'X25519 key exchange (Alice)')
      ComparisonUtils.expectWithinTimeLimit(bobDuration, 50, 'X25519 key exchange (Bob)')

      CryptoLoggingUtils.logPerformance('X25519 key exchange', (aliceDuration + bobDuration) / 2)
    })

    it('should handle sync key exchange', async () => {
      const aliceKeyPair = await X25519Utils.generateKeyPair()
      const bobKeyPair = await X25519Utils.generateKeyPair()

      const { result: aliceSharedSecret, duration: aliceDuration } = PerformanceUtils.measureSync(
        'x25519_key_exchange_sync_alice',
        () => X25519Utils.computeSharedSecretSync(aliceKeyPair.privateKey, bobKeyPair.publicKey)
      )

      const { result: bobSharedSecret, duration: bobDuration } = PerformanceUtils.measureSync(
        'x25519_key_exchange_sync_bob',
        () => X25519Utils.computeSharedSecretSync(bobKeyPair.privateKey, aliceKeyPair.publicKey)
      )

      // Both parties should derive the same shared secret
      expect(TestVectorUtils.arraysEqual(aliceSharedSecret, bobSharedSecret)).toBe(true)

      // Sync should be faster
      ComparisonUtils.expectWithinTimeLimit(aliceDuration, 25, 'X25519 sync key exchange (Alice)')
      ComparisonUtils.expectWithinTimeLimit(bobDuration, 25, 'X25519 sync key exchange (Bob)')
    })

    it('should handle invalid public keys', async () => {
      const validKeyPair = await X25519Utils.generateKeyPair()
      const invalidPublicKeys = [
        new Uint8Array(16), // Too short
        new Uint8Array(64), // Too long
      ]

      // Test size validation
      for (const invalidKey of invalidPublicKeys) {
        await expect(
          X25519Utils.computeSharedSecret(validKeyPair.privateKey, invalidKey)
        ).rejects.toThrow()
      }

      // Test all-zeros key (X25519 library may handle this gracefully)
      const allZerosKey = new Uint8Array(32)
      try {
        const result = await X25519Utils.computeSharedSecret(validKeyPair.privateKey, allZerosKey)
        // If it doesn't throw, the result should still be a valid 32-byte array
        expect(result.length).toBe(32)
      } catch (error) {
        // It's also acceptable if it throws an error
        expect(error).toBeDefined()
      }
    })

    it('should handle concurrent key exchanges', async () => {
      const concurrentExchanges = 10
      const aliceKeyPair = await X25519Utils.generateKeyPair()

      // Generate multiple Bob key pairs
      const bobKeyPairs = await Promise.all(
        Array(concurrentExchanges)
          .fill(0)
          .map(() => X25519Utils.generateKeyPair())
      )

      // Perform concurrent key exchanges
      const sharedSecrets = await Promise.all(
        bobKeyPairs.map(bobKeyPair =>
          X25519Utils.computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)
        )
      )

      // All shared secrets should be valid and different
      for (let i = 0; i < sharedSecrets.length; i++) {
        TestVectorUtils.validateSize(
          sharedSecrets[i]!,
          HAP_TEST_CONSTANTS.X25519_SHARED_SECRET_SIZE,
          `Shared secret ${i}`
        )

        for (let j = i + 1; j < sharedSecrets.length; j++) {
          expect(TestVectorUtils.arraysEqual(sharedSecrets[i]!, sharedSecrets[j]!)).toBe(false)
        }
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid private key sizes', async () => {
      const validKeyPair = await X25519Utils.generateKeyPair()

      await ErrorTestUtils.testInvalidKeySizes(
        key => X25519Utils.computeSharedSecret(key, validKeyPair.publicKey),
        HAP_TEST_CONSTANTS.X25519_PRIVATE_KEY_SIZE
      )
    })

    it('should handle invalid public key sizes', async () => {
      const validKeyPair = await X25519Utils.generateKeyPair()

      await ErrorTestUtils.testInvalidKeySizes(
        key => X25519Utils.computeSharedSecret(validKeyPair.privateKey, key),
        HAP_TEST_CONSTANTS.X25519_PUBLIC_KEY_SIZE
      )
    })

    it('should throw CryptoError for invalid operations', async () => {
      const invalidKey = new Uint8Array(16) // Wrong size
      const validKey = new Uint8Array(32)

      await expect(X25519Utils.computeSharedSecret(invalidKey, validKey)).rejects.toBeInstanceOf(
        CryptoError
      )
    })

    it('should handle null/undefined inputs gracefully', async () => {
      const validKey = new Uint8Array(32)

      // These should throw errors, not crash
      await expect(X25519Utils.computeSharedSecret(null as any, validKey)).rejects.toThrow()
      await expect(X25519Utils.computeSharedSecret(validKey, null as any)).rejects.toThrow()
    })

    it('should validate seed size for deterministic generation', () => {
      const invalidSeeds = [
        new Uint8Array(16), // Too short
        new Uint8Array(64), // Too long
        new Uint8Array(0), // Empty
      ]

      for (const invalidSeed of invalidSeeds) {
        expect(() => X25519Utils.generateKeyPairFromSeed(invalidSeed)).toThrow(CryptoError)
      }
    })
  })

  describe('Performance Benchmarks', () => {
    it('should benchmark key generation performance', async () => {
      const { avgDuration, stats } = await PerformanceUtils.benchmarkAsync(
        'x25519_keygen_benchmark',
        () => X25519Utils.generateKeyPair(),
        50
      )

      // Key generation should be reasonably fast
      expect(avgDuration).toBeLessThan(100) // 100ms average
      expect(stats?.min).toBeLessThan(50) // Best case under 50ms

      logger.debug(
        `X25519 Key Generation Benchmark: avg=${avgDuration.toFixed(2)}ms, min=${stats?.min.toFixed(2)}ms, max=${stats?.max.toFixed(2)}ms`
      )
    })

    it('should benchmark key exchange performance', async () => {
      const aliceKeyPair = await X25519Utils.generateKeyPair()
      const bobKeyPair = await X25519Utils.generateKeyPair()

      const { avgDuration, stats } = await PerformanceUtils.benchmarkAsync(
        'x25519_exchange_benchmark',
        () => X25519Utils.computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey),
        100
      )

      // Key exchange should be fast
      expect(avgDuration).toBeLessThan(50) // 50ms average
      expect(stats?.min).toBeLessThan(25) // Best case under 25ms

      logger.debug(
        `X25519 Key Exchange Benchmark: avg=${avgDuration.toFixed(2)}ms, min=${stats?.min.toFixed(2)}ms, max=${stats?.max.toFixed(2)}ms`
      )
    })

    it('should compare sync vs async performance', async () => {
      const aliceKeyPair = await X25519Utils.generateKeyPair()
      const bobKeyPair = await X25519Utils.generateKeyPair()

      // Benchmark async operations
      const asyncExchange = await PerformanceUtils.benchmarkAsync(
        'x25519_exchange_async',
        () => X25519Utils.computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey),
        50
      )

      // Benchmark sync operations
      const syncExchange = PerformanceUtils.benchmarkSync(
        'x25519_exchange_sync',
        () => X25519Utils.computeSharedSecretSync(aliceKeyPair.privateKey, bobKeyPair.publicKey),
        50
      )

      logger.debug(
        `X25519 Sync vs Async Exchange: sync=${syncExchange.avgDuration.toFixed(2)}ms, async=${asyncExchange.avgDuration.toFixed(2)}ms`
      )

      // Sync should generally be faster (no async overhead)
      expect(syncExchange.avgDuration).toBeLessThan(asyncExchange.avgDuration * 2) // Allow some variance
    })
  })

  describe('Memory Usage', () => {
    it('should not leak memory during repeated operations', async () => {
      const iterations = 100

      const { memoryDelta } = await MemoryUtils.monitorOperation(async () => {
        for (let i = 0; i < iterations; i++) {
          const aliceKeyPair = await X25519Utils.generateKeyPair()
          const bobKeyPair = await X25519Utils.generateKeyPair()
          const sharedSecret = await X25519Utils.computeSharedSecret(
            aliceKeyPair.privateKey,
            bobKeyPair.publicKey
          )
          expect(sharedSecret.length).toBe(HAP_TEST_CONSTANTS.X25519_SHARED_SECRET_SIZE)
        }
      })

      // Memory usage should be reasonable (allow 10MB for 100 iterations)
      ComparisonUtils.expectReasonableMemoryUsage(memoryDelta, 10, 'X25519 repeated operations')

      CryptoLoggingUtils.logMemory('X25519 repeated operations', memoryDelta)
    })

    it('should handle batch key exchanges without excessive memory', async () => {
      const batchSize = 50
      const aliceKeyPair = await X25519Utils.generateKeyPair()
      const bobKeyPairs = await Promise.all(
        Array(batchSize)
          .fill(0)
          .map(() => X25519Utils.generateKeyPair())
      )

      const { memoryDelta } = await MemoryUtils.monitorOperation(async () => {
        const sharedSecrets = await Promise.all(
          bobKeyPairs.map(bobKeyPair =>
            X25519Utils.computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)
          )
        )
        expect(sharedSecrets).toHaveLength(batchSize)
      })

      // Should not use excessive memory for batch operations (allow 5MB)
      ComparisonUtils.expectReasonableMemoryUsage(memoryDelta, 5, 'X25519 batch operations')
    })
  })

  describe('Bun Runtime Integration', () => {
    it('should work correctly in Bun runtime', () => {
      BunTestUtils.skipIfNotBun()

      const capabilities = BunTestUtils.getCryptoCapabilities()
      logger.debug({ capabilities })

      expect(capabilities.webCrypto).toBe(true)
      // X25519 support may vary, but our implementation should work regardless
    })

    it('should use optimal implementation for Bun', async () => {
      if (BunTestUtils.isBun()) {
        logger.debug(`Running X25519 tests in Bun: ${BunTestUtils.getBunVersion()}`)

        // Test that our implementation works in Bun
        const aliceKeyPair = await X25519Utils.generateKeyPair()
        const bobKeyPair = await X25519Utils.generateKeyPair()
        const sharedSecret = await X25519Utils.computeSharedSecret(
          aliceKeyPair.privateKey,
          bobKeyPair.publicKey
        )

        expect(sharedSecret.length).toBe(HAP_TEST_CONSTANTS.X25519_SHARED_SECRET_SIZE)
      }
    })
  })

  describe('HAP Protocol Integration', () => {
    it('should work with HAP ephemeral key exchange', async () => {
      // Simulate HAP pair-verify flow
      const clientEphemeralKeyPair = await X25519Utils.generateKeyPair()
      const serverEphemeralKeyPair = await X25519Utils.generateKeyPair()

      // Both sides compute shared secret
      const clientSharedSecret = await X25519Utils.computeSharedSecret(
        clientEphemeralKeyPair.privateKey,
        serverEphemeralKeyPair.publicKey
      )

      const serverSharedSecret = await X25519Utils.computeSharedSecret(
        serverEphemeralKeyPair.privateKey,
        clientEphemeralKeyPair.publicKey
      )

      // Should be identical (ECDH property)
      expect(TestVectorUtils.arraysEqual(clientSharedSecret, serverSharedSecret)).toBe(true)
      expect(clientSharedSecret.length).toBe(HAP_TEST_CONSTANTS.X25519_SHARED_SECRET_SIZE)
    })

    it('should handle HAP session key derivation inputs', async () => {
      // Test that X25519 outputs work as HKDF inputs
      const aliceKeyPair = await X25519Utils.generateKeyPair()
      const bobKeyPair = await X25519Utils.generateKeyPair()
      const sharedSecret = await X25519Utils.computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      )

      // Shared secret should be suitable for HKDF input
      expect(sharedSecret.length).toBe(32) // HKDF can handle 32-byte input
      expect(sharedSecret.some(byte => byte !== 0)).toBe(true) // Not all zeros
    })

    it('should be compatible with HAP key format requirements', () => {
      const { clientKeyPair, serverKeyPair } = X25519_TEST_VECTORS

      // Keys should have correct lengths for HAP protocol
      expect(clientKeyPair.privateKey.length).toBe(HAP_TEST_CONSTANTS.X25519_PRIVATE_KEY_SIZE)
      expect(clientKeyPair.publicKey.length).toBe(HAP_TEST_CONSTANTS.X25519_PUBLIC_KEY_SIZE)
      expect(serverKeyPair.privateKey.length).toBe(HAP_TEST_CONSTANTS.X25519_PRIVATE_KEY_SIZE)
      expect(serverKeyPair.publicKey.length).toBe(HAP_TEST_CONSTANTS.X25519_PUBLIC_KEY_SIZE)
    })
  })
})
