// ============================================================================
// 1. GENERAL PURPOSE: BufferPool
// ============================================================================

export interface BufferPoolConfig {
  /** Size buckets for more efficient pooling */
  sizeBuckets?: number[]
  /** Max buffers per bucket */
  maxPerBucket?: number
  /** Clear buffers on release for security */
  clearOnRelease?: boolean
}

export class BufferPool {
  private readonly pools: Map<number, Buffer[]> = new Map()
  private readonly config: Required<BufferPoolConfig>

  constructor(config: BufferPoolConfig = {}) {
    this.config = {
      sizeBuckets: [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384],
      maxPerBucket: 10,
      clearOnRelease: true,
      ...config,
    }
  }

  /**
   * Get a buffer from pool or allocate new
   * Uses bucket sizes for better reuse
   */
  acquire(size: number): Buffer {
    // Find appropriate bucket
    const bucketSize = this.getBucketSize(size)

    const pool = this.pools.get(bucketSize)
    if (pool && pool.length > 0) {
      const buffer = pool.pop()!
      // Return slice if needed
      return size === bucketSize ? buffer : buffer.subarray(0, size)
    }

    return Buffer.allocUnsafe(size)
  }

  /**
   * Release buffer back to pool
   */
  release(buffer: Buffer): void {
    const bucketSize = this.getBucketSize(buffer.length)

    let pool = this.pools.get(bucketSize)
    if (!pool) {
      pool = []
      this.pools.set(bucketSize, pool)
    }

    if (pool.length < this.config.maxPerBucket) {
      if (this.config.clearOnRelease) {
        buffer.fill(0)
      }
      pool.push(buffer)
    }
  }

  private getBucketSize(size: number): number {
    // Find smallest bucket that fits
    for (const bucket of this.config.sizeBuckets) {
      if (size <= bucket) return bucket
    }
    return size // Use exact size if larger than all buckets
  }

  clear(): void {
    this.pools.clear()
  }
}

export class StreamBuffer {
  private buffer: Buffer
  private writePos = 0
  private readPos = 0

  constructor(
    private initialSize = 4096,
    private maxSize = 1048576, // 1MB
    private pool: BufferPool
  ) {
    this.buffer = this.allocate(initialSize)
  }

  /**
   * Append data to buffer
   */
  append(data: Buffer): void {
    const required = this.writePos + data.length

    if (required > this.maxSize) {
      throw new Error(`StreamBuffer overflow: ${required} > ${this.maxSize}`)
    }

    if (required > this.buffer.length) {
      this.grow(required)
    }

    data.copy(this.buffer, this.writePos)
    this.writePos += data.length
  }

  /**
   * Consume and return data
   */
  consume(length: number): Buffer | null {
    const available = this.writePos - this.readPos
    if (length > available) return null

    const data = this.buffer.subarray(this.readPos, this.readPos + length)
    this.readPos += length

    // Compact if needed
    if (this.readPos > this.buffer.length / 2) {
      this.compact()
    }

    return data
  }

  /**
   * Peek at data without consuming
   */
  peek(length: number, offset = 0): Buffer | null {
    const available = this.writePos - this.readPos - offset
    if (length > available) return null

    return this.buffer.subarray(this.readPos + offset, this.readPos + offset + length)
  }

  get available(): number {
    return this.writePos - this.readPos
  }
  get currentPoolCapacity(): number {
    return this.buffer.length
  }

  private grow(minSize: number): void {
    const newSize = Math.min(this.buffer.length * 2, this.maxSize)
    if (newSize < minSize) {
      throw new Error('StreamBuffer cannot grow enough')
    }

    const newBuffer = this.allocate(newSize)
    this.buffer.copy(newBuffer, 0, this.readPos, this.writePos)

    this.pool.release(this.buffer)

    this.buffer = newBuffer
    this.writePos -= this.readPos
    this.readPos = 0
  }

  private compact(): void {
    if (this.readPos === 0) return

    const dataLength = this.writePos - this.readPos
    this.buffer.copy(this.buffer, 0, this.readPos, this.writePos)
    this.readPos = 0
    this.writePos = dataLength
  }

  private allocate(size: number): Buffer {
    return this.pool.acquire(size)
  }

  reset(): void {
    this.readPos = 0
    this.writePos = 0
  }
}

// ============================================================================
// 3. BUN-SPECIFIC: Optimized utilities
// ============================================================================
export enum NonceFormat {
  Companion,
  Hap,
}
export class BunOptimizedUtils {
  /**
   * Optimized nonce creation for ChaCha20
   */
  static createNonce(counter: number, format: NonceFormat): Uint8Array {
    const nonce = new Uint8Array(12)
    const view = new DataView(nonce.buffer)

    if (format === NonceFormat.Companion) {
      // Companion format: 12-byte counter directly at offset 0
      // counter=1 -> [0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]
      view.setUint32(0, counter, true)
    } else {
      // HAP format: 4 zero bytes + 8-byte counter
      // counter=1 -> [0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00]
      // First 4 bytes stay zero
      view.setBigUint64(4, BigInt(counter), true)
    }
    return nonce
  }

  /**
   * Fast constant-time comparison
   */
  static constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= (a[i] ?? 0) ^ (b[i] ?? 0)
    }
    return result === 0
  }

  /**
   * Optimized hex conversion using lookup table
   */
  private static readonly HEX_CHARS = '0123456789abcdef'

  static toHex(buffer: Uint8Array): string {
    let result = ''
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i]!
      result += this.HEX_CHARS[byte >>> 4]! + this.HEX_CHARS[byte & 0x0f]!
    }
    return result
  }

  static fromHex(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
      throw new Error('Hex string must have even length')
    }

    const result = new Uint8Array(hex.length >>> 1)
    for (let i = 0; i < result.length; i++) {
      const high = this.parseHexChar(hex[i * 2]!)
      const low = this.parseHexChar(hex[i * 2 + 1]!)

      if (high === -1 || low === -1) {
        throw new Error(`Invalid hex at position ${i * 2}`)
      }

      result[i] = (high << 4) | low
    }
    return result
  }

  private static parseHexChar(char: string): number {
    const code = char.charCodeAt(0)
    if (code >= 48 && code <= 57) return code - 48 // '0'-'9'
    if (code >= 97 && code <= 102) return code - 87 // 'a'-'f'
    if (code >= 65 && code <= 70) return code - 55 // 'A'-'F'
    return -1
  }

  /**
   * Efficient buffer concatenation
   */
  static concat(buffers: Buffer[]): Buffer {
    let totalLength = 0
    for (const buf of buffers) {
      totalLength += buf.length
    }

    const result = Buffer.allocUnsafe(totalLength)
    let offset = 0
    for (const buf of buffers) {
      buf.copy(result, offset)
      offset += buf.length
    }

    return result
  }

  static ensureArrayBuffer(input: ArrayBufferLike | ArrayBufferView): ArrayBuffer {
    if (input instanceof ArrayBuffer) {
      return input
    }
    if (ArrayBuffer.isView(input)) {
      // Handle views with byteOffset/byteLength
      return BunOptimizedUtils.ensureArrayBuffer(
        input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
      )
    }
    // SharedArrayBuffer or other - copy it
    return new Uint8Array(input).slice().buffer
  }
}

// ============================================================================
// 6. ENHANCED: BufferReader and BufferWriter
// ============================================================================

export class BufferReader {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  readUInt8(): number {
    const value = this.buffer.readUInt8(this.offset)
    this.offset += 1
    return value
  }

  readUInt16BE(): number {
    const value = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readUInt16LE(): number {
    const value = this.buffer.readUInt16LE(this.offset)
    this.offset += 2
    return value
  }
  readUInt24BE(): number {
    const high = this.buffer.readUInt8(this.offset)
    const mid = this.buffer.readUInt8(this.offset + 1)
    const low = this.buffer.readUInt8(this.offset + 2)
    this.offset += 3
    return (high << 16) | (mid << 8) | low
  }

  readUInt24LE(): number {
    const low = this.buffer.readUInt8(this.offset)
    const mid = this.buffer.readUInt8(this.offset + 1)
    const high = this.buffer.readUInt8(this.offset + 2)
    this.offset += 3
    return (high << 16) | (mid << 8) | low
  }
  readUInt32BE(): number {
    const value = this.buffer.readUInt32BE(this.offset)
    this.offset += 4
    return value
  }

  readUInt32LE(): number {
    const value = this.buffer.readUInt32LE(this.offset)
    this.offset += 4
    return value
  }

  readBuffer(length: number): Buffer {
    const value = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  readRemaining(): Buffer {
    const value = this.buffer.subarray(this.offset)
    this.offset = this.buffer.length
    return value
  }

  peek(length: number): Buffer {
    return this.buffer.subarray(this.offset, this.offset + length)
  }

  skip(bytes: number): void {
    this.offset += bytes
  }

  get hasMore(): boolean {
    return this.offset < this.buffer.length
  }

  get remaining(): number {
    return this.buffer.length - this.offset
  }

  get currentOffset(): number {
    return this.offset
  }

  set currentOffset(value: number) {
    this.offset = value
  }
}

export class BufferWriter {
  private buffer: Buffer
  private offset = 0

  constructor(
    initialSize = 256,
    private pool?: BufferPool
  ) {
    this.buffer = pool ? pool.acquire(initialSize) : Buffer.allocUnsafe(initialSize)
  }

  writeUtf8(str: string): void {
    const bytes = Buffer.byteLength(str, 'utf-8')
    this.ensureCapacity(bytes)
    this.buffer.write(str, this.offset, bytes, 'utf-8')
    this.offset += bytes
  }

  writeUInt8(value: number): void {
    this.ensureCapacity(1)
    this.buffer.writeUInt8(value, this.offset)
    this.offset += 1
  }

  writeUInt16BE(value: number): void {
    this.ensureCapacity(2)
    this.buffer.writeUInt16BE(value, this.offset)
    this.offset += 2
  }

  writeUInt16LE(value: number): void {
    this.ensureCapacity(2)
    this.buffer.writeUInt16LE(value, this.offset)
    this.offset += 2
  }

  writeUInt24BE(value: number): void {
    this.ensureCapacity(3)
    this.buffer.writeUIntBE(value, this.offset, 3)
    this.offset += 3
  }

  writeUInt32BE(value: number): void {
    this.ensureCapacity(4)
    this.buffer.writeUInt32BE(value, this.offset)
    this.offset += 4
  }

  writeUInt32LE(value: number): void {
    this.ensureCapacity(4)
    this.buffer.writeUInt32LE(value, this.offset)
    this.offset += 4
  }
  writeFloat64(value: number): void {
    this.ensureCapacity(8)
    this.buffer.writeDoubleLE(value, this.offset)
    this.offset += 8
  }
  writeBuffer(buffer: Buffer): void {
    this.ensureCapacity(buffer.length)
    buffer.copy(this.buffer, this.offset)
    this.offset += buffer.length
  }

  toBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset)
  }

  private ensureCapacity(bytes: number): void {
    const required = this.offset + bytes

    if (required > this.buffer.length) {
      const newSize = Math.max(this.buffer.length * 2, required)
      const newBuffer = this.pool ? this.pool.acquire(newSize) : Buffer.allocUnsafe(newSize)

      this.buffer.copy(newBuffer, 0, 0, this.offset)

      if (this.pool) {
        this.pool.release(this.buffer)
      }

      this.buffer = newBuffer
    }
  }
}
