/**
 * Comprehensive HKDF key derivation tests for HAP pairing
 *
 * Tests HKDF-SHA512 key derivation using both deterministic test vectors
 * and real cryptographic operations. Optimized for Bun runtime with
 * performance benchmarks and HAP-specific test cases.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { HkdfUtils } from '@/core/crypto/hkdf.ts'
import { HAP_INFO, HAP_SALT } from '@/core/crypto/constants.ts'
import {
  HAP_TEST_CONSTANTS,
  HKDF_TEST_VECTORS,
  X25519_TEST_VECTORS,
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
const logger = createLogger('HKDFTests')
describe('HKDF Key Derivation Operations', () => {
  beforeEach(() => {
    PerformanceUtils.reset()
    CryptoLoggingUtils.setVerbose(false) // Set to true for debugging
  })

  describe('Key Derivation', () => {
    it('should derive keys with HKDF-SHA512', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info
      const length = 32

      const { result: derivedKey, duration } = await PerformanceUtils.measureAsync(
        'hkdf_derive',
        () => HkdfUtils.derive(ikm, salt, info, length)
      )

      // Validate derived key
      expect(derivedKey).toBeInstanceOf(Uint8Array)
      expect(derivedKey.length).toBe(length)

      // Key should not be all zeros
      expect(derivedKey.some(byte => byte !== 0)).toBe(true)

      CryptoLoggingUtils.logPerformance('HKDF derivation', duration)
    })

    it('should derive keys synchronously', () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info
      const length = 32

      const { result: derivedKey, duration } = PerformanceUtils.measureSync(
        'hkdf_derive_sync',
        () => HkdfUtils.deriveSync(ikm, salt, info, length)
      )

      // Validate derived key
      expect(derivedKey).toBeInstanceOf(Uint8Array)
      expect(derivedKey.length).toBe(length)

      // Key should not be all zeros
      expect(derivedKey.some(byte => byte !== 0)).toBe(true)

      CryptoLoggingUtils.logPerformance('HKDF sync derivation', duration)
    })

    it('should produce consistent results for same inputs', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info
      const length = 32

      const key1 = await HkdfUtils.derive(ikm, salt, info, length)
      const key2 = await HkdfUtils.derive(ikm, salt, info, length)

      expect(ComparisonUtils.arraysEqual(key1, key2)).toBe(true)
    })

    it('should produce different keys for different inputs', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info1 = HKDF_TEST_VECTORS.info
      const info2 = HKDF_TEST_VECTORS.longInfo
      const length = 32

      const key1 = await HkdfUtils.derive(ikm, salt, info1, length)
      const key2 = await HkdfUtils.derive(ikm, salt, info2, length)

      expect(ComparisonUtils.arraysEqual(key1, key2)).toBe(false)
    })

    it('should handle different output lengths', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info

      // Test various lengths
      const lengths = [16, 32, 48, 64, 128]

      for (const length of lengths) {
        const derivedKey = await HkdfUtils.derive(ikm, salt, info, length)
        expect(derivedKey.length).toBe(length)
        expect(derivedKey.some(byte => byte !== 0)).toBe(true)
      }
    })

    it('should handle empty salt', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const emptySalt = HKDF_TEST_VECTORS.emptySalt
      const info = HKDF_TEST_VECTORS.info
      const length = 32

      const derivedKey = await HkdfUtils.derive(ikm, emptySalt, info, length)

      expect(derivedKey).toBeInstanceOf(Uint8Array)
      expect(derivedKey.length).toBe(length)
      expect(derivedKey.some(byte => byte !== 0)).toBe(true)
    })

    it('should handle empty info', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const emptyInfo = HKDF_TEST_VECTORS.emptyInfo
      const length = 32

      const derivedKey = await HkdfUtils.derive(ikm, salt, emptyInfo, length)

      expect(derivedKey).toBeInstanceOf(Uint8Array)
      expect(derivedKey.length).toBe(length)
      expect(derivedKey.some(byte => byte !== 0)).toBe(true)
    })
  })

  describe('HAP-Specific Key Derivation', () => {
    it('should derive pair-setup encryption key', async () => {
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      const { result: encryptionKey, duration } = await PerformanceUtils.measureAsync(
        'hap_pair_setup_key',
        () => HkdfUtils.derivePairSetupKey(sharedSecret)
      )

      expect(encryptionKey.length).toBe(32)
      expect(encryptionKey.some(byte => byte !== 0)).toBe(true)

      CryptoLoggingUtils.logPerformance('HAP pair-setup key derivation', duration)
    })

    it('should derive controller authentication key', async () => {
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      const controllerKey = await HkdfUtils.deriveControllerKey(sharedSecret)

      expect(controllerKey.length).toBe(32)
      expect(controllerKey.some(byte => byte !== 0)).toBe(true)
    })

    it('should derive accessory authentication key', async () => {
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      const accessoryKey = await HkdfUtils.deriveAccessoryKey(sharedSecret)

      expect(accessoryKey.length).toBe(32)
      expect(accessoryKey.some(byte => byte !== 0)).toBe(true)
    })

    it('should derive session keys for pair-verify', async () => {
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      const { result: sessionKeys, duration } = await PerformanceUtils.measureAsync(
        'hap_session_keys',
        () => HkdfUtils.deriveSessionKeys(sharedSecret)
      )

      expect(sessionKeys.readKey.length).toBe(32)
      expect(sessionKeys.writeKey.length).toBe(32)
      expect(sessionKeys.readKey.some(byte => byte !== 0)).toBe(true)
      expect(sessionKeys.writeKey.some(byte => byte !== 0)).toBe(true)

      // Read and write keys should be different
      expect(ComparisonUtils.arraysEqual(sessionKeys.readKey, sessionKeys.writeKey)).toBe(false)

      CryptoLoggingUtils.logPerformance('HAP session keys derivation', duration)
    })

    it('should derive keys with correct HAP salts', async () => {
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      // Test with explicit HAP salts
      const pairSetupKey = await HkdfUtils.derive(
        sharedSecret,
        HAP_SALT.PAIR_SETUP_ENCRYPT,
        new Uint8Array(0),
        32
      )

      const controllerKey = await HkdfUtils.derive(
        sharedSecret,
        HAP_SALT.PAIR_SETUP_CONTROLLER,
        new Uint8Array(0),
        32
      )

      const accessoryKey = await HkdfUtils.derive(
        sharedSecret,
        HAP_SALT.PAIR_SETUP_ACCESSORY,
        new Uint8Array(0),
        32
      )

      // All keys should be different
      expect(ComparisonUtils.arraysEqual(pairSetupKey, controllerKey)).toBe(false)
      expect(ComparisonUtils.arraysEqual(pairSetupKey, accessoryKey)).toBe(false)
      expect(ComparisonUtils.arraysEqual(controllerKey, accessoryKey)).toBe(false)
    })

    it('should derive session keys with correct HAP info', async () => {
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      const readKey = await HkdfUtils.derive(
        sharedSecret,
        HAP_SALT.PAIR_VERIFY_ENCRYPT,
        HAP_INFO.CONTROL_READ,
        32
      )

      const writeKey = await HkdfUtils.derive(
        sharedSecret,
        HAP_SALT.PAIR_VERIFY_ENCRYPT,
        HAP_INFO.CONTROL_WRITE,
        32
      )

      expect(readKey.length).toBe(32)
      expect(writeKey.length).toBe(32)
      expect(ComparisonUtils.arraysEqual(readKey, writeKey)).toBe(false)
    })

    it('should use sync versions for HAP operations', () => {
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      // Test sync HAP key derivation methods
      const pairSetupKey = HkdfUtils.derivePairSetupKeySync(sharedSecret)
      const controllerKey = HkdfUtils.deriveControllerKeySync(sharedSecret)
      const accessoryKey = HkdfUtils.deriveAccessoryKeySync(sharedSecret)
      const sessionKeys = HkdfUtils.deriveSessionKeysSync(sharedSecret)

      expect(pairSetupKey.length).toBe(32)
      expect(controllerKey.length).toBe(32)
      expect(accessoryKey.length).toBe(32)
      expect(sessionKeys.readKey.length).toBe(32)
      expect(sessionKeys.writeKey.length).toBe(32)

      // All keys should be different
      expect(ComparisonUtils.arraysEqual(pairSetupKey, controllerKey)).toBe(false)
      expect(ComparisonUtils.arraysEqual(sessionKeys.readKey, sessionKeys.writeKey)).toBe(false)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid input key material', async () => {
      const emptySalt = new Uint8Array(0)
      const info = new Uint8Array(0)

      // Note: HKDF actually allows empty IKM, so this might succeed
      // Test with truly invalid input instead
      await expect(HkdfUtils.derive(null as any, emptySalt, info, 32)).rejects.toThrow()
    })

    it('should handle invalid length parameter', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info

      // Test negative length
      await expect(HkdfUtils.derive(ikm, salt, info, -1)).rejects.toThrow()

      // Test zero length
      await expect(HkdfUtils.derive(ikm, salt, info, 0)).rejects.toThrow()
    })

    it('should throw CryptoError for invalid operations', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info

      try {
        await HkdfUtils.derive(ikm, salt, info, -1)
        expect(false).toBe(true) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    it('should handle null/undefined inputs gracefully', async () => {
      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info

      await ErrorTestUtils.expectAsyncError(() => HkdfUtils.derive(null as any, salt, info, 32))

      await ErrorTestUtils.expectAsyncError(() => HkdfUtils.derive(ikm, null as any, info, 32))

      await ErrorTestUtils.expectAsyncError(() => HkdfUtils.derive(ikm, salt, null as any, 32))
    })
  })

  describe('Performance Benchmarks', () => {
    it('should benchmark HKDF key derivation performance', async () => {
      const ikm = RandomTestDataUtils.randomBytes(32)
      const salt = RandomTestDataUtils.randomBytes(16)
      const info = RandomTestDataUtils.randomBytes(8)
      const iterations = 100

      const { avgDuration } = await PerformanceUtils.benchmarkAsync(
        'HKDF Key Derivation',
        async () => {
          await HkdfUtils.derive(ikm, salt, info, 32)
        },
        iterations
      )

      const totalDuration = avgDuration * iterations
      CryptoLoggingUtils.logBenchmark('HKDF Key Derivation', totalDuration, iterations)
      expect(totalDuration).toBeLessThan(5000) // Should complete in under 5 seconds
    })

    it('should benchmark sync vs async HKDF performance', async () => {
      const ikm = RandomTestDataUtils.randomBytes(32)
      const salt = RandomTestDataUtils.randomBytes(16)
      const info = RandomTestDataUtils.randomBytes(8)
      const iterations = 100

      const asyncResults = await PerformanceUtils.benchmarkAsync(
        'HKDF Async',
        async () => {
          await HkdfUtils.derive(ikm, salt, info, 32)
        },
        iterations
      )

      const syncResults = PerformanceUtils.benchmarkSync(
        'HKDF Sync',
        () => {
          HkdfUtils.deriveSync(ikm, salt, info, 32)
        },
        iterations
      )

      logger.debug(
        `HKDF Sync vs Async Derivation: sync=${syncResults.avgDuration}ms, async=${asyncResults.avgDuration}ms`
      )

      // Both should be reasonable
      const asyncTotal = asyncResults.avgDuration * iterations
      const syncTotal = syncResults.avgDuration * iterations
      expect(asyncTotal).toBeLessThan(10000)
      expect(syncTotal).toBeLessThan(10000)
    })

    it('should benchmark HAP-specific key derivation patterns', async () => {
      const sharedSecret = RandomTestDataUtils.randomBytes(32)
      const iterations = 50

      const hapDerivations = [
        () => HkdfUtils.derivePairSetupKey(sharedSecret),
        () => HkdfUtils.deriveControllerKey(sharedSecret),
        () => HkdfUtils.deriveAccessoryKey(sharedSecret),
        () => HkdfUtils.deriveSessionKeys(sharedSecret),
      ]

      for (const [index, derivation] of hapDerivations.entries()) {
        const { avgDuration } = await PerformanceUtils.benchmarkAsync(
          `HAP Derivation ${index + 1}`,
          derivation as () => Promise<unknown>,
          iterations
        )

        const totalDuration = avgDuration * iterations
        CryptoLoggingUtils.logBenchmark(
          `HAP Key Derivation ${index + 1}`,
          totalDuration,
          iterations
        )
        expect(totalDuration).toBeLessThan(3000)
      }
    })
  })

  describe('Memory Usage', () => {
    it('should not leak memory during repeated operations', async () => {
      const iterations = 1000
      const ikm = RandomTestDataUtils.randomBytes(32)
      const salt = RandomTestDataUtils.randomBytes(16)
      const info = RandomTestDataUtils.randomBytes(8)

      const { memoryUsed } = await MemoryUtils.measureMemoryUsage(async () => {
        for (let i = 0; i < iterations; i++) {
          const derivedKey = await HkdfUtils.derive(ikm, salt, info, 32)
          // Use the key to prevent optimization
          expect(derivedKey.length).toBe(32)
        }
      })

      CryptoLoggingUtils.logMemoryUsage('HKDF repeated operations', memoryUsed, iterations)

      // Memory usage should be reasonable (less than 10MB for 1000 operations)
      expect(memoryUsed).toBeLessThan(10 * 1024 * 1024)
    })

    it('should handle large key derivation without excessive memory', async () => {
      const ikm = RandomTestDataUtils.randomBytes(1024) // Large IKM
      const salt = RandomTestDataUtils.randomBytes(64) // Large salt
      const info = RandomTestDataUtils.randomBytes(256) // Large info
      const keyLength = 1024 // Large output

      const { memoryUsed } = await MemoryUtils.measureMemoryUsage(async () => {
        const derivedKey = await HkdfUtils.derive(ikm, salt, info, keyLength)
        expect(derivedKey.length).toBe(keyLength)
      })

      CryptoLoggingUtils.logMemoryUsage('HKDF large key derivation', memoryUsed, 1)

      // Should not use excessive memory for large inputs
      expect(memoryUsed).toBeLessThan(5 * 1024 * 1024) // Less than 5MB
    })
  })

  describe('Bun Runtime Integration', () => {
    it('should work correctly in Bun runtime', async () => {
      const runtimeInfo = BunTestUtils.getBunRuntimeInfo()
      logger.debug(`Running HKDF tests in Bun: ${runtimeInfo.bunVersion}`)

      const ikm = HKDF_TEST_VECTORS.ikm
      const salt = HKDF_TEST_VECTORS.salt
      const info = HKDF_TEST_VECTORS.info

      const derivedKey = await HkdfUtils.derive(ikm, salt, info, 32)

      expect(derivedKey).toBeInstanceOf(Uint8Array)
      expect(derivedKey.length).toBe(32)
    })

    it('should use optimal implementation for Bun', async () => {
      const capabilities = BunTestUtils.detectCryptoCapabilities()
      logger.debug({ capabilities })

      expect(capabilities.hkdf).toBe(true)
      expect(capabilities.webCrypto).toBe(true)

      // Test that HKDF works with Bun's WebCrypto
      const ikm = RandomTestDataUtils.randomBytes(32)
      const salt = RandomTestDataUtils.randomBytes(16)
      const info = RandomTestDataUtils.randomBytes(8)

      const derivedKey = await HkdfUtils.derive(ikm, salt, info, 32)
      expect(derivedKey.length).toBe(32)
    })
  })

  describe('Cross-Compatibility with pyatv', () => {
    it('should produce deterministic outputs for known inputs', async () => {
      // Use the same inputs that pyatv might use
      const ikm = new Uint8Array(Array(32).fill(0xaa)) // pyatv pattern
      const salt = HAP_SALT.PAIR_SETUP_ENCRYPT
      const info = new Uint8Array(0)
      const length = 32

      // Derive key multiple times - should be identical
      const key1 = await HkdfUtils.derive(ikm, salt, info, length)
      const key2 = await HkdfUtils.derive(ikm, salt, info, length)
      const key3 = HkdfUtils.deriveSync(ikm, salt, info, length)

      expect(ComparisonUtils.arraysEqual(key1, key2)).toBe(true)
      expect(ComparisonUtils.arraysEqual(key1, key3)).toBe(true)
    })

    it('should handle HAP protocol message flows', async () => {
      // Simulate full HAP key derivation flow
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret

      // Pair-setup phase keys
      const pairSetupKey = await HkdfUtils.derivePairSetupKey(sharedSecret)
      const controllerKey = await HkdfUtils.deriveControllerKey(sharedSecret)
      const accessoryKey = await HkdfUtils.deriveAccessoryKey(sharedSecret)

      // Pair-verify phase keys
      const sessionKeys = await HkdfUtils.deriveSessionKeys(sharedSecret)

      // Validate all keys are present and different
      const allKeys = [
        pairSetupKey,
        controllerKey,
        accessoryKey,
        sessionKeys.readKey,
        sessionKeys.writeKey,
      ]

      for (let i = 0; i < allKeys.length; i++) {
        expect(allKeys[i]!.length).toBe(32)
        expect(allKeys[i]!.some(byte => byte !== 0)).toBe(true)

        for (let j = i + 1; j < allKeys.length; j++) {
          expect(ComparisonUtils.arraysEqual(allKeys[i]!, allKeys[j]!)).toBe(false)
        }
      }
    })

    it('should be compatible with HAP key format requirements', () => {
      // HAP requires 32-byte keys for most operations
      const keySize = HAP_TEST_CONSTANTS.HKDF_KEY_SIZE
      expect(keySize).toBe(32)

      // Validate that our key derivation produces this size
      const sharedSecret = X25519_TEST_VECTORS.expectedSharedSecret
      const derivedKey = HkdfUtils.derivePairSetupKeySync(sharedSecret)

      expect(derivedKey.length).toBe(keySize)
    })
  })
})
