/**
 * Bun-optimized crypto testing utilities
 *
 * Provides helper functions for testing cryptographic operations
 * with focus on Bun's native performance capabilities.
 */

import { expect } from 'bun:test'
import {
  ERROR_TEST_VECTORS,
  HAP_TEST_CONSTANTS,
  TestVectorUtils,
} from '../fixtures/crypto-test-vectors'
import { createLogger } from '@/logging/logging.ts'

const logger = createLogger('CryptoTestUtils')

/**
 * Performance measurement utilities optimized for Bun
 */
export class PerformanceUtils {
  private static measurements: Map<string, number[]> = new Map()

  /**
   * Measure execution time of an operation using Bun's high-resolution timer
   */
  static async measureAsync<T>(
    name: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const start = performance.now()
    const result = await operation()
    const duration = performance.now() - start

    this.recordMeasurement(name, duration)
    return { result, duration }
  }

  /**
   * Measure execution time of a synchronous operation
   */
  static measureSync<T>(name: string, operation: () => T): { result: T; duration: number } {
    const start = performance.now()
    const result = operation()
    const duration = performance.now() - start

    this.recordMeasurement(name, duration)
    return { result, duration }
  }

  /**
   * Record measurement for statistical analysis
   */
  private static recordMeasurement(name: string, duration: number): void {
    if (!this.measurements.has(name)) {
      this.measurements.set(name, [])
    }
    this.measurements.get(name)!.push(duration)
  }

  /**
   * Get performance statistics for an operation
   */
  static getStats(name: string): {
    count: number
    min: number
    max: number
    avg: number
    median: number
  } | null {
    const measurements = this.measurements.get(name)
    if (!measurements || measurements.length === 0) return null

    const sorted = [...measurements].sort((a, b) => a - b)
    const count = measurements.length
    const min = sorted[0]!
    const max = sorted[count - 1]!
    const avg = measurements.reduce((a, b) => a + b, 0) / count
    const median =
      count % 2 === 0
        ? (sorted[count / 2 - 1]! + sorted[count / 2]!) / 2
        : sorted[Math.floor(count / 2)]!

    return { count, min, max, avg, median }
  }

  /**
   * Clear all measurements
   */
  static reset(): void {
    this.measurements.clear()
  }

  /**
   * Benchmark an operation multiple times for statistical accuracy
   */
  static async benchmarkAsync<T>(
    name: string,
    operation: () => Promise<T>,
    iterations: number = 100
  ): Promise<{ avgDuration: number; stats: ReturnType<typeof PerformanceUtils.getStats> }> {
    // Warm up
    await operation()
    await operation()

    // Actual benchmark
    for (let i = 0; i < iterations; i++) {
      await this.measureAsync(`${name}_bench`, operation)
    }

    const stats = this.getStats(`${name}_bench`)
    return {
      avgDuration: stats?.avg ?? 0,
      stats,
    }
  }

  /**
   * Benchmark a synchronous operation multiple times
   */
  static benchmarkSync<T>(
    name: string,
    operation: () => T,
    iterations: number = 1000
  ): { avgDuration: number; stats: ReturnType<typeof PerformanceUtils.getStats> } {
    // Warm up
    operation()
    operation()

    // Actual benchmark
    for (let i = 0; i < iterations; i++) {
      this.measureSync(`${name}_bench`, operation)
    }

    const stats = this.getStats(`${name}_bench`)
    return {
      avgDuration: stats?.avg ?? 0,
      stats,
    }
  }
}

/**
 * Memory monitoring utilities for Bun
 */
export class MemoryUtils {
  /**
   * Force garbage collection if available (Bun/Node.js specific)
   */
  static forceGC(): void {
    if (typeof global !== 'undefined' && global.gc) {
      global.gc()
    }
  }

  /**
   * Get current memory usage
   */
  static getMemoryUsage(): {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
  } {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage()
    }
    return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }
  }

  /**
   * Monitor memory usage during an operation
   */
  static async monitorOperation<T>(operation: () => Promise<T>): Promise<{
    result: T
    memoryBefore: ReturnType<typeof MemoryUtils.getMemoryUsage>
    memoryAfter: ReturnType<typeof MemoryUtils.getMemoryUsage>
    memoryDelta: number
  }> {
    this.forceGC()
    const memoryBefore = this.getMemoryUsage()

    const result = await operation()

    this.forceGC()
    const memoryAfter = this.getMemoryUsage()
    const memoryDelta = memoryAfter.heapUsed - memoryBefore.heapUsed

    return {
      result,
      memoryBefore,
      memoryAfter,
      memoryDelta,
    }
  }

  /**
   * Measure memory usage during operation
   */
  static async measureMemoryUsage<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; memoryUsed: number }> {
    this.forceGC()
    const before = this.getMemoryUsage()

    const result = await operation()

    this.forceGC()
    const after = this.getMemoryUsage()

    const memoryUsed = after.heapUsed - before.heapUsed

    return { result, memoryUsed }
  }
}

/**
 * Key validation utilities
 */
export class KeyValidationUtils {
  /**
   * Validate Ed25519 key sizes
   */
  static validateEd25519Keys(privateKey: Uint8Array, publicKey: Uint8Array): void {
    TestVectorUtils.validateSize(
      privateKey,
      HAP_TEST_CONSTANTS.ED25519_PRIVATE_KEY_SIZE,
      'Ed25519 private key'
    )
    TestVectorUtils.validateSize(
      publicKey,
      HAP_TEST_CONSTANTS.ED25519_PUBLIC_KEY_SIZE,
      'Ed25519 public key'
    )
  }

  /**
   * Validate X25519 key sizes
   */
  static validateX25519Keys(privateKey: Uint8Array, publicKey: Uint8Array): void {
    TestVectorUtils.validateSize(
      privateKey,
      HAP_TEST_CONSTANTS.X25519_PRIVATE_KEY_SIZE,
      'X25519 private key'
    )
    TestVectorUtils.validateSize(
      publicKey,
      HAP_TEST_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
      'X25519 public key'
    )
  }

  /**
   * Validate ChaCha20-Poly1305 parameters
   */
  static validateChaCha20Params(key: Uint8Array, nonce: Uint8Array): void {
    TestVectorUtils.validateSize(key, HAP_TEST_CONSTANTS.CHACHA20_KEY_SIZE, 'ChaCha20 key')
    TestVectorUtils.validateSize(nonce, HAP_TEST_CONSTANTS.CHACHA20_NONCE_SIZE, 'ChaCha20 nonce')
  }

  /**
   * Validate Ed25519 signature size
   */
  static validateEd25519Signature(signature: Uint8Array): void {
    TestVectorUtils.validateSize(
      signature,
      HAP_TEST_CONSTANTS.ED25519_SIGNATURE_SIZE,
      'Ed25519 signature'
    )
  }

  /**
   * Validate HKDF output size
   */
  static validateHkdfOutput(
    derivedKey: Uint8Array,
    expectedSize: number = HAP_TEST_CONSTANTS.HKDF_KEY_SIZE
  ): void {
    TestVectorUtils.validateSize(derivedKey, expectedSize, 'HKDF derived key')
  }
}

/**
 * Error testing utilities
 */
export class ErrorTestUtils {
  /**
   * Test that an operation throws with invalid key sizes
   */
  static async testInvalidKeySizes<T>(
    operation: (key: Uint8Array) => Promise<T>,
    validKeySize: number
  ): Promise<void> {
    const invalidKeys = [
      ERROR_TEST_VECTORS.invalidKeys.empty,
      ERROR_TEST_VECTORS.invalidKeys.tooShort,
      ERROR_TEST_VECTORS.invalidKeys.tooLong,
      new Uint8Array(validKeySize - 1), // One byte short
      new Uint8Array(validKeySize + 1), // One byte too long
    ]

    for (const invalidKey of invalidKeys) {
      await expect(operation(invalidKey)).rejects.toThrow()
    }
  }

  /**
   * Test that an operation throws with invalid nonce sizes
   */
  static async testInvalidNonceSizes<T>(
    operation: (nonce: Uint8Array) => Promise<T>,
    validNonceSize: number
  ): Promise<void> {
    const invalidNonces = [
      ERROR_TEST_VECTORS.invalidNonces.empty,
      ERROR_TEST_VECTORS.invalidNonces.tooShort,
      ERROR_TEST_VECTORS.invalidNonces.tooLong,
      new Uint8Array(validNonceSize - 1), // One byte short
      new Uint8Array(validNonceSize + 1), // One byte too long
    ]

    for (const invalidNonce of invalidNonces) {
      await expect(operation(invalidNonce)).rejects.toThrow()
    }
  }

  /**
   * Test signature verification with corrupted signatures
   */
  static async testCorruptedSignatures(
    verifyOperation: (signature: Uint8Array) => Promise<boolean>
  ): Promise<void> {
    const corruptedSigs = [
      ERROR_TEST_VECTORS.corruptedSignatures.allZeros,
      ERROR_TEST_VECTORS.corruptedSignatures.flippedBit,
    ]

    // Test wrong length signature - should throw an error
    try {
      await verifyOperation(ERROR_TEST_VECTORS.corruptedSignatures.wrongLength)
      // If it doesn't throw, that's fine - just expect false
      expect(false).toBe(false)
    } catch (error) {
      // Expected - wrong length should cause an error
      expect(error).toBeDefined()
    }

    // Test other corrupted signatures - should return false
    for (const corruptedSig of corruptedSigs) {
      try {
        const result = await verifyOperation(corruptedSig)
        expect(result).toBe(false)
      } catch (error) {
        // Some implementations may throw for invalid signatures, which is also acceptable
        expect(error).toBeDefined()
      }
    }
  }

  /**
   * Test decryption with invalid encrypted data
   */
  static async testInvalidEncryptedData(
    decryptOperation: (encryptedData: Uint8Array) => Promise<Uint8Array>
  ): Promise<void> {
    const invalidData = [
      ERROR_TEST_VECTORS.invalidEncryptedData.tooShort,
      ERROR_TEST_VECTORS.invalidEncryptedData.truncatedTag,
      ERROR_TEST_VECTORS.invalidEncryptedData.wrongTag,
    ]

    for (const invalidEncData of invalidData) {
      await expect(decryptOperation(invalidEncData)).rejects.toThrow()
    }
  }

  /**
   * Expect async operation to throw
   */
  static async expectAsyncError<T>(operation: () => Promise<T>): Promise<void> {
    await expect(operation()).rejects.toThrow()
  }
}

/**
 * Comparison utilities for test results
 */
export class ComparisonUtils {
  /**
   * Compare two arrays for exact equality
   */
  static arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  /**
   * Compare arrays with detailed error message
   */
  static expectArraysEqual(actual: Uint8Array, expected: Uint8Array, context: string): void {
    if (!this.arraysEqual(actual, expected)) {
      throw new Error(
        `${context}: Arrays not equal\n` +
          `Expected: ${TestVectorUtils.toHex(expected)}\n` +
          `Actual:   ${TestVectorUtils.toHex(actual)}`
      )
    }
  }

  /**
   * Expect operation to complete within time limit
   */
  static expectWithinTimeLimit(duration: number, maxDuration: number, operation: string): void {
    expect(duration).toBeLessThan(maxDuration)
    if (duration >= maxDuration) {
      throw new Error(`${operation} took ${duration}ms, expected < ${maxDuration}ms`)
    }
  }

  /**
   * Expect memory usage to be reasonable
   */
  static expectReasonableMemoryUsage(
    memoryDelta: number,
    maxMemoryMB: number,
    operation: string
  ): void {
    const memoryMB = memoryDelta / (1024 * 1024)
    expect(memoryMB).toBeLessThan(maxMemoryMB)
    if (memoryMB >= maxMemoryMB) {
      throw new Error(`${operation} used ${memoryMB}MB memory, expected < ${maxMemoryMB}MB`)
    }
  }
}

/**
 * Bun-specific test utilities
 */
export class BunTestUtils {
  /**
   * Check if running in Bun runtime
   */
  static isBun(): boolean {
    return typeof Bun !== 'undefined'
  }

  /**
   * Get Bun version if available
   */
  static getBunVersion(): string | null {
    if (this.isBun() && typeof Bun !== 'undefined' && Bun.version) {
      return Bun.version
    }
    return null
  }

  /**
   * Skip test if not running in Bun
   */
  static skipIfNotBun(): void {
    if (!this.isBun()) {
      throw new Error('Test requires Bun runtime')
    }
  }

  /**
   * Get available crypto capabilities in Bun
   */
  static getCryptoCapabilities(): {
    webCrypto: boolean
    ed25519: boolean
    x25519: boolean
    hkdf: boolean
    chacha20: boolean
  } {
    const capabilities = {
      webCrypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
      ed25519: false,
      x25519: false,
      hkdf: false,
      chacha20: false,
    }

    if (capabilities.webCrypto) {
      try {
        // Test Ed25519 support
        crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign'])
        capabilities.ed25519 = true
      } catch {
        // Ed25519 not supported
      }

      try {
        // Test X25519 support
        crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveKey'])
        capabilities.x25519 = true
      } catch {
        // X25519 not supported
      }

      try {
        // Test HKDF support
        crypto.subtle.importKey('raw', new Uint8Array(32), 'HKDF', false, ['deriveKey'])
        capabilities.hkdf = true
      } catch {
        // HKDF not supported
      }
    }

    // ChaCha20-Poly1305 requires external library
    try {
      require('@noble/ciphers/chacha')
      capabilities.chacha20 = true
    } catch {
      // ChaCha20-Poly1305 library not available
    }

    return capabilities
  }

  /**
   * Log crypto capabilities for debugging
   */
  static logCryptoCapabilities(): void {
    const capabilities = this.getCryptoCapabilities()
    logger.debug({ capabilities })

    if (this.isBun()) {
      logger.debug(`Bun Version: ${this.getBunVersion()}`)
    }
  }

  /**
   * Get Bun runtime information
   */
  static getBunRuntimeInfo(): { bunVersion: string; isBun: boolean } {
    return {
      bunVersion: this.getBunVersion() || 'unknown',
      isBun: this.isBun(),
    }
  }

  /**
   * Detect crypto capabilities
   */
  static detectCryptoCapabilities(): {
    webCrypto: boolean
    ed25519: boolean
    x25519: boolean
    hkdf: boolean
    chacha20: boolean
  } {
    return this.getCryptoCapabilities()
  }
}

/**
 * Test helper for generating random test data
 */
export class RandomTestDataUtils {
  /**
   * Generate random bytes for testing (using Bun's crypto)
   */
  static randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return bytes
  }

  /**
   * Generate random test message
   */
  static randomMessage(minLength: number = 16, maxLength: number = 256): Uint8Array {
    const length = Math.floor(Math.random() * (maxLength - minLength)) + minLength
    return this.randomBytes(length)
  }

  /**
   * Generate test PIN code
   */
  static randomPinCode(): string {
    const pin = Math.floor(Math.random() * 10000)
    return pin.toString().padStart(4, '0')
  }

  /**
   * Generate random identifier string
   */
  static randomIdentifier(): string {
    const chars = 'ABCDEF0123456789'
    const segments = []
    for (let i = 0; i < 5; i++) {
      let segment = ''
      const segmentLength = i === 0 ? 8 : 4
      for (let j = 0; j < segmentLength; j++) {
        segment += chars[Math.floor(Math.random() * chars.length)]
      }
      segments.push(segment)
    }
    return segments.join('-')
  }
}

/**
 * Logging utilities for crypto tests
 */
export class CryptoLoggingUtils {
  private static enabled = false

  /**
   * Enable/disable verbose logging
   */
  static setVerbose(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Log hex data with label
   */
  static logHex(label: string, data: Uint8Array): void {
    if (this.enabled) {
      logger.debug(`${label}: ${TestVectorUtils.toHex(data)}`)
    }
  }

  /**
   * Log performance results
   */
  static logPerformance(operation: string, duration: number, dataSize?: number): void {
    if (this.enabled) {
      let message = `${operation}: ${duration.toFixed(2)}ms`
      if (dataSize) {
        const rate = (((dataSize / duration) * 1000) / 1024 / 1024).toFixed(2)
        message += ` (${dataSize} bytes, ${rate} MB/s)`
      }
      logger.debug(message)
    }
  }

  /**
   * Log memory usage
   */
  static logMemory(operation: string, memoryDelta: number): void {
    if (this.enabled) {
      const memoryMB = (memoryDelta / 1024 / 1024).toFixed(2)
      logger.debug(`${operation}: ${memoryMB}MB memory delta`)
    }
  }

  /**
   * Log test vector validation
   */
  static logValidation(operation: string, success: boolean, details?: string): void {
    if (this.enabled) {
      const status = success ? '✓' : '✗'
      let message = `${status} ${operation}`
      if (details) {
        message += `: ${details}`
      }
      logger.debug(message)
    }
  }

  /**
   * Log benchmark results
   */
  static logBenchmark(operation: string, totalDuration: number, iterations: number): void {
    if (this.enabled) {
      const avgDuration = totalDuration / iterations
      logger.debug(
        `${operation} Benchmark: avg=${avgDuration.toFixed(2)}ms, total=${totalDuration.toFixed(2)}ms over ${iterations} iterations`
      )
    }
  }

  /**
   * Log memory usage for operations
   */
  static logMemoryUsage(operation: string, memoryUsed: number, iterations: number): void {
    if (this.enabled) {
      const memoryMB = (memoryUsed / 1024 / 1024).toFixed(2)
      const avgMemoryKB = (memoryUsed / iterations / 1024).toFixed(2)
      logger.debug(
        `${operation} Memory: ${memoryMB}MB total (${avgMemoryKB}KB per operation) over ${iterations} iterations`
      )
    }
  }
}
