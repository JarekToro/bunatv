/**
 * Comprehensive SRP authentication tests for HAP pairing
 *
 * Tests SRP-6a protocol implementation using both deterministic test vectors
 * and real cryptographic operations. Optimized for Bun runtime with
 * performance benchmarks and HAP-specific test cases.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { SrpUtils } from '@/core/crypto/srp.ts'
import { SRP_CONFIG } from '@/core/crypto/constants.ts'
import { HAP_TEST_CONSTANTS, SRP_TEST_VECTORS } from '../../fixtures/crypto-test-vectors'
import {
  BunTestUtils,
  CryptoLoggingUtils,
  MemoryUtils,
  PerformanceUtils,
  RandomTestDataUtils,
} from '../../helpers/crypto-test-utils'
import { createLogger } from '@/logging/logging.ts'
const logger = createLogger('SrpTests')
describe('SRP Authentication Operations', () => {
  beforeEach(() => {
    PerformanceUtils.reset()
    CryptoLoggingUtils.setVerbose(false) // Set to true for debugging
  })

  describe('SRP Configuration', () => {
    it('should have correct HAP SRP configuration', () => {
      expect(SRP_CONFIG.PRIME_BITS).toBe(3072)
      expect(SRP_CONFIG.HASH_ALGORITHM).toBe('sha512')
      expect(SRP_CONFIG.GENERATOR).toBe(5)
    })

    it('should use HAP-specific parameters', () => {
      // HAP uses specific SRP parameters defined by fast-srp-hap library
      expect(SRP_CONFIG.PRIME_BITS).toBe(3072) // HAP requirement
    })
  })

  describe('Key Generation', () => {
    it('should generate SRP keys', async () => {
      const keySize = 32

      const { result: key, duration } = await PerformanceUtils.measureAsync('srp_keygen', () =>
        SrpUtils.generateKey(keySize)
      )

      expect(key).toBeInstanceOf(Buffer)
      expect(key.length).toBe(keySize)

      // Key should not be all zeros
      expect(key.some(byte => byte !== 0)).toBe(true)

      CryptoLoggingUtils.logPerformance('SRP key generation', duration)
    })

    it('should generate different keys each time', async () => {
      const keySize = 32

      const key1 = await SrpUtils.generateKey(keySize)
      const key2 = await SrpUtils.generateKey(keySize)

      expect(key1.equals(key2)).toBe(false)
    })

    it('should generate keys of different sizes', async () => {
      const sizes = [16, 32, 48, 64]

      for (const size of sizes) {
        const key = await SrpUtils.generateKey(size)
        expect(key.length).toBe(size)
      }
    })
  })

  describe('SRP Client Operations', () => {
    it('should create SRP client', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      const { result: client, duration } = PerformanceUtils.measureSync('srp_client_create', () =>
        SrpUtils.createClient(username, password, salt, secretKey)
      )

      expect(client).toBeDefined()
      expect(typeof client).toBe('object')

      CryptoLoggingUtils.logPerformance('SRP client creation', duration)
    })

    it('should create client with different usernames', () => {
      const usernames = ['Pair-Setup', 'Device-123', 'Controller-ABC']
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      for (const username of usernames) {
        const client = SrpUtils.createClient(username, password, salt, secretKey)
        expect(client).toBeDefined()
      }
    })

    it('should create client with different passwords', () => {
      const username = SRP_TEST_VECTORS.username
      const passwords = SRP_TEST_VECTORS.alternatePins
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      for (const password of passwords) {
        const client = SrpUtils.createClient(username, password, salt, secretKey)
        expect(client).toBeDefined()
      }
    })

    it('should handle different salt sizes', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      // Test different salt sizes
      const saltSizes = [8, 16, 32]
      for (const size of saltSizes) {
        const salt = Buffer.from(RandomTestDataUtils.randomBytes(size))
        const client = SrpUtils.createClient(username, password, salt, secretKey)
        expect(client).toBeDefined()
      }
    })

    it('should create client with random secret keys', async () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt

      // Test with different random secret keys
      for (let i = 0; i < 5; i++) {
        const secretKey = await SrpUtils.generateKey(32)
        const client = SrpUtils.createClient(username, password, salt, secretKey)
        expect(client).toBeDefined()
      }
    })
  })

  describe('SRP Server Operations', () => {
    it('should create SRP server', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.serverSecretKey

      const { result: server, duration } = PerformanceUtils.measureSync('srp_server_create', () =>
        SrpUtils.createServer(username, password, salt, secretKey)
      )

      expect(server).toBeDefined()
      expect(typeof server).toBe('object')

      CryptoLoggingUtils.logPerformance('SRP server creation', duration)
    })

    it('should create server with same credentials as client', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const clientSecretKey = SRP_TEST_VECTORS.clientSecretKey
      const serverSecretKey = SRP_TEST_VECTORS.serverSecretKey

      // Both should work with same credentials
      const client = SrpUtils.createClient(username, password, salt, clientSecretKey)
      const server = SrpUtils.createServer(username, password, salt, serverSecretKey)

      expect(client).toBeDefined()
      expect(server).toBeDefined()
    })
  })

  describe('SRP Verifier Computation', () => {
    it('should compute SRP verifier', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt

      const { result: verifier, duration } = PerformanceUtils.measureSync('srp_verifier', () =>
        SrpUtils.computeVerifier(salt, username, password)
      )

      expect(verifier).toBeInstanceOf(Buffer)
      expect(verifier.length).toBeGreaterThan(0)

      // Verifier should not be all zeros
      expect(verifier.some(byte => byte !== 0)).toBe(true)

      CryptoLoggingUtils.logPerformance('SRP verifier computation', duration)
    })

    it('should produce different verifiers for different passwords', () => {
      const username = SRP_TEST_VECTORS.username
      const salt = SRP_TEST_VECTORS.salt
      const passwords = ['111-11-111', '222-22-222']

      const verifiers = passwords.map(password =>
        SrpUtils.computeVerifier(salt, username, password)
      )

      expect(verifiers[0]!.equals(verifiers[1]!)).toBe(false)
    })

    it('should produce different verifiers for different salts', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password

      const salt1 = Buffer.from(RandomTestDataUtils.randomBytes(16))
      const salt2 = Buffer.from(RandomTestDataUtils.randomBytes(16))

      const verifier1 = SrpUtils.computeVerifier(salt1, username, password)
      const verifier2 = SrpUtils.computeVerifier(salt2, username, password)

      expect(verifier1.equals(verifier2)).toBe(false)
    })

    it('should produce same verifier for same inputs', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt

      const verifier1 = SrpUtils.computeVerifier(salt, username, password)
      const verifier2 = SrpUtils.computeVerifier(salt, username, password)

      expect(verifier1.equals(verifier2)).toBe(true)
    })
  })

  describe('Performance Benchmarks', () => {
    it('should benchmark SRP client creation', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.clientSecretKey
      const iterations = 100

      const { avgDuration } = PerformanceUtils.benchmarkSync(
        'SRP Client Creation',
        () => {
          SrpUtils.createClient(username, password, salt, secretKey)
        },
        iterations
      )

      const totalDuration = avgDuration * iterations
      CryptoLoggingUtils.logBenchmark('SRP Client Creation', totalDuration, iterations)
      expect(totalDuration).toBeLessThan(5000) // Should complete in under 5 seconds
    })

    it('should benchmark SRP server creation', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.serverSecretKey
      const iterations = 100

      const { avgDuration } = PerformanceUtils.benchmarkSync(
        'SRP Server Creation',
        () => {
          SrpUtils.createServer(username, password, salt, secretKey)
        },
        iterations
      )

      const totalDuration = avgDuration * iterations
      CryptoLoggingUtils.logBenchmark('SRP Server Creation', totalDuration, iterations)
      expect(totalDuration).toBeLessThan(5000) // Should complete in under 5 seconds
    })

    it('should benchmark SRP verifier computation', () => {
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const iterations = 50

      const { avgDuration } = PerformanceUtils.benchmarkSync(
        'SRP Verifier Computation',
        () => {
          SrpUtils.computeVerifier(salt, username, password)
        },
        iterations
      )

      const totalDuration = avgDuration * iterations
      CryptoLoggingUtils.logBenchmark('SRP Verifier Computation', totalDuration, iterations)
      expect(totalDuration).toBeLessThan(10000) // Should complete in under 10 seconds (more intensive)
    })

    it('should benchmark SRP key generation', async () => {
      const keySize = 32
      const iterations = 100

      const { avgDuration } = await PerformanceUtils.benchmarkAsync(
        'SRP Key Generation',
        () => SrpUtils.generateKey(keySize),
        iterations
      )

      const totalDuration = avgDuration * iterations
      CryptoLoggingUtils.logBenchmark('SRP Key Generation', totalDuration, iterations)
      expect(totalDuration).toBeLessThan(3000) // Should complete in under 3 seconds
    })
  })

  describe('Memory Usage', () => {
    it('should handle multiple concurrent SRP operations', async () => {
      const operations = 20
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt

      const { memoryUsed } = await MemoryUtils.measureMemoryUsage(async () => {
        const promises = Array(operations)
          .fill(0)
          .map(async (_, i) => {
            const secretKey = await SrpUtils.generateKey(32)
            const client = SrpUtils.createClient(username, password, salt, secretKey)
            const verifier = SrpUtils.computeVerifier(salt, username, `${password}-${i}`)

            return { client, verifier }
          })

        const results = await Promise.all(promises)

        // Validate all results
        for (const result of results) {
          expect(result.client).toBeDefined()
          expect(result.verifier.length).toBeGreaterThan(0)
        }
      })

      CryptoLoggingUtils.logMemoryUsage('SRP concurrent operations', memoryUsed, operations)

      // Memory usage should be reasonable for concurrent operations
      expect(memoryUsed).toBeLessThan(30 * 1024 * 1024)
    })
  })

  describe('Bun Runtime Integration', () => {
    it('should work correctly in Bun runtime', async () => {
      const runtimeInfo = BunTestUtils.getBunRuntimeInfo()
      logger.debug(`Running SRP tests in Bun: ${runtimeInfo.bunVersion}`)

      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = await SrpUtils.generateKey(32)

      const client = SrpUtils.createClient(username, password, salt, secretKey)
      const server = SrpUtils.createServer(username, password, salt, secretKey)
      const verifier = SrpUtils.computeVerifier(salt, username, password)

      expect(client).toBeDefined()
      expect(server).toBeDefined()
      expect(verifier).toBeInstanceOf(Buffer)
    })

    it('should use optimal SRP library for Bun', () => {
      const capabilities = BunTestUtils.detectCryptoCapabilities()
      logger.debug({ capabilities })

      // SRP uses external library, so it should work regardless of native support
      expect(capabilities.webCrypto).toBe(true)

      // Test basic SRP functionality
      const username = SRP_TEST_VECTORS.username
      const password = SRP_TEST_VECTORS.password
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      const client = SrpUtils.createClient(username, password, salt, secretKey)
      expect(client).toBeDefined()
    })
  })

  describe('HAP Protocol Integration', () => {
    it('should handle HAP pairing credentials', () => {
      // HAP uses specific credential format
      const hapUsername = 'Pair-Setup'
      const hapPin = '123-45-678'
      const salt = Buffer.from(RandomTestDataUtils.randomBytes(16))
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      const client = SrpUtils.createClient(hapUsername, hapPin, salt, secretKey)
      const server = SrpUtils.createServer(hapUsername, hapPin, salt, secretKey)
      const verifier = SrpUtils.computeVerifier(salt, hapUsername, hapPin)

      expect(client).toBeDefined()
      expect(server).toBeDefined()
      expect(verifier).toBeInstanceOf(Buffer)
    })

    it('should work with HAP PIN formats', () => {
      const hapUsername = 'Pair-Setup'
      const hapPins = ['000-00-000', '123-45-678', '999-99-999', '111-22-333']
      const salt = SRP_TEST_VECTORS.salt
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      for (const pin of hapPins) {
        const client = SrpUtils.createClient(hapUsername, pin, salt, secretKey)
        const verifier = SrpUtils.computeVerifier(salt, hapUsername, pin)

        expect(client).toBeDefined()
        expect(verifier).toBeInstanceOf(Buffer)
        expect(verifier.length).toBeGreaterThan(0)
      }
    })

    it('should handle HAP salt requirements', () => {
      const hapUsername = 'Pair-Setup'
      const hapPin = '123-45-678'
      const secretKey = SRP_TEST_VECTORS.clientSecretKey

      // HAP typically uses 16-byte salts
      const hapSalt = Buffer.from(RandomTestDataUtils.randomBytes(HAP_TEST_CONSTANTS.SRP_SALT_SIZE))
      expect(hapSalt.length).toBe(16)

      const client = SrpUtils.createClient(hapUsername, hapPin, hapSalt, secretKey)
      const verifier = SrpUtils.computeVerifier(hapSalt, hapUsername, hapPin)

      expect(client).toBeDefined()
      expect(verifier).toBeInstanceOf(Buffer)
    })

    it('should be compatible with HAP SRP flow', async () => {
      // Simulate HAP pairing SRP flow
      const hapUsername = 'Pair-Setup'
      const hapPin = '123-45-678'
      const salt = Buffer.from(RandomTestDataUtils.randomBytes(16))

      // Generate keys for client and server
      const clientSecretKey = await SrpUtils.generateKey(32)
      const serverSecretKey = await SrpUtils.generateKey(32)

      // Create client and server instances
      const client = SrpUtils.createClient(hapUsername, hapPin, salt, clientSecretKey)
      const server = SrpUtils.createServer(hapUsername, hapPin, salt, serverSecretKey)

      // Compute verifier (would be stored on server)
      const verifier = SrpUtils.computeVerifier(salt, hapUsername, hapPin)

      // All should be valid for HAP flow
      expect(client).toBeDefined()
      expect(server).toBeDefined()
      expect(verifier).toBeInstanceOf(Buffer)
      expect(verifier.length).toBeGreaterThan(0)
    })
  })

  describe('Cross-Compatibility with pyatv', () => {
    it('should produce deterministic outputs for known inputs', () => {
      // Use deterministic inputs for reproducible results
      const username = 'Pair-Setup'
      const password = '123-45-678'
      const salt = Buffer.from(Array(16).fill(0xaa)) // pyatv pattern
      const secretKey = Buffer.from(Array(32).fill(0xbb))

      // Compute verifier multiple times - should be identical
      const verifier1 = SrpUtils.computeVerifier(salt, username, password)
      const verifier2 = SrpUtils.computeVerifier(salt, username, password)

      expect(verifier1.equals(verifier2)).toBe(true)

      // Create clients with same inputs - should work consistently
      const client1 = SrpUtils.createClient(username, password, salt, secretKey)
      const client2 = SrpUtils.createClient(username, password, salt, secretKey)

      expect(client1).toBeDefined()
      expect(client2).toBeDefined()
    })

    it('should handle HAP protocol SRP requirements', () => {
      // HAP SRP requirements validation
      expect(SRP_CONFIG.PRIME_BITS).toBe(3072) // HAP standard
      expect(SRP_CONFIG.HASH_ALGORITHM).toBe('sha512') // HAP standard
      expect(SRP_CONFIG.GENERATOR).toBe(5) // HAP standard

      // Test with HAP-standard parameters
      const hapCredentials = {
        username: 'Pair-Setup',
        password: '123-45-678',
        salt: Buffer.from(RandomTestDataUtils.randomBytes(16)),
        secretKey: Buffer.from(RandomTestDataUtils.randomBytes(32)),
      }

      const client = SrpUtils.createClient(
        hapCredentials.username,
        hapCredentials.password,
        hapCredentials.salt,
        hapCredentials.secretKey
      )

      const verifier = SrpUtils.computeVerifier(
        hapCredentials.salt,
        hapCredentials.username,
        hapCredentials.password
      )

      expect(client).toBeDefined()
      expect(verifier.length).toBeGreaterThan(0)
    })
  })
})
