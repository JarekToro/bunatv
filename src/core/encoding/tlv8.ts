import { createLogger } from '@/logging/logging.ts'
import { BufferWriter, BufferReader } from './buffer-utils.ts'

/**
 * Implementation of TLV8 (Type-Length-Value 8-bit) encoding/decoding
 * used by HomeKit Accessory Protocol (HAP) pairing process.
 *
 * TLV8 Format:
 * - Type: 1 byte (tag)
 * - Length: 1 byte (0-255)
 * - Value: 0-255 bytes
 *
 * For values larger than 255 bytes, they are fragmented across multiple
 * TLV entries with the same type tag.
 *
 * @example
 * ```typescript
 * // Encoding a simple TLV
 * const encoded = TLV8.encode(TlvValue.Method, Buffer.from([Method.PairSetup]));
 *
 * // Decoding TLV data
 * const decoded = TLV8.decodeObject(encoded);
 *
 * // Using TlvBuilder for complex messages
 * const message = new TlvBuilder()
 *   .method(Method.PairSetup)
 *   .seqNo(State.M1)
 *   .build();
 * ```
 */
const logger = createLogger("bunatv:encoding:tlv8");
/**
 * TLV value types as defined in the HAP specification
 */
export enum TlvValue {
  // Standardized HAP keys
  Method = 0x00,
  Identifier = 0x01,
  Salt = 0x02,
  PublicKey = 0x03,
  Proof = 0x04,
  EncryptedData = 0x05,
  SeqNo = 0x06,
  Error = 0x07,
  BackOff = 0x08,
  Certificate = 0x09,
  Signature = 0x0a,
  Permissions = 0x0b,
  FragmentData = 0x0c,
  FragmentLast = 0x0d,

  // Apple internal/extended keys
  Name = 0x11,
  AdditionalData = 0x11, // Companion protocol: OPACK-encoded device metadata in M5
  Flags = 0x13,
}

/**
 * Flags used with TlvValue.Flags
 */
export enum Flags {
  TransientPairing = 0x10,
}

/**
 * Error codes as defined in HAP specification
 */
export enum ErrorCode {
  Unknown = 0x01,
  Authentication = 0x02,
  BackOff = 0x03,
  MaxPeers = 0x04,
  MaxTries = 0x05,
  Unavailable = 0x06,
  Busy = 0x07,
}

/**
 * HAP pairing method types
 */
export enum Method {
  PairSetup = 0x00,
  PairSetupWithAuth = 0x01,
  PairVerify = 0x02,
  AddPairing = 0x03,
  RemovePairing = 0x04,
  ListPairing = 0x05,
}

/**
 * HAP pairing state sequence numbers
 */
export enum State {
  M1 = 0x01,
  M2 = 0x02,
  M3 = 0x03,
  M4 = 0x04,
  M5 = 0x05,
  M6 = 0x06,
}

/**
 * Individual TLV item
 */
export interface TlvItem {
  type: number
  value: Buffer
}

/**
 * TLV data as a record mapping type numbers to their Buffer values
 */
export type TlvData = Record<number, Buffer>

/**
 * Error thrown when TLV8 data is malformed or invalid
 */
export class Tlv8Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Tlv8Error'
  }
}

/**
 * Core TLV8 encoding and decoding functionality
 */
export class TLV8 {
  /**
   * Encode a single TLV item into a Buffer.
   * Handles fragmentation for values larger than 255 bytes.
   *
   * @param type - The TLV type (0-255)
   * @param value - The value to encode
   * @returns Encoded TLV data as Buffer
   * @throws {Tlv8Error} When type is out of range
   *
   * @example
   * ```typescript
   * const encoded = TLV8.encode(TlvValue.Method, Buffer.from([Method.PairSetup]));
   * ```
   */
  static encode(type: number, value: Buffer): Buffer {
    if (type < 0 || type > 255) {
      throw new Tlv8Error(`TLV type must be 0-255, got ${type}`)
    }

    if (value.length === 0) {
      return Buffer.from([type, 0])
    }

    // Use BufferWriter for efficient concatenation
    const writer = new BufferWriter(value.length + Math.ceil(value.length / 255) * 2)
    let offset = 0

    // Fragment values larger than 255 bytes
    while (offset < value.length) {
      const chunkSize = Math.min(255, value.length - offset)

      writer.writeUInt8(type)
      writer.writeUInt8(chunkSize)
      writer.writeBuffer(value.subarray(offset, offset + chunkSize))

      offset += chunkSize
    }

    return writer.toBuffer()
  }

  /**
   * Decode TLV8 data from a Buffer into an array of TLV items.
   * Does not defragment - use decodeObject() for that.
   *
   * @param data - The TLV8 encoded data
   * @returns Array of individual TLV items
   * @throws {Tlv8Error} When data is malformed
   *
   * @example
   * ```typescript
   * const items = TLV8.decode(buffer);
   * console.log(items[0].type, items[0].value);
   * ```
   */
  static decode(data: Buffer): TlvItem[] {
    const reader = new BufferReader(data)
    const items: TlvItem[] = []

    while (reader.hasMore) {
      // Check if we have at least 2 bytes for header
      if (reader.remaining < 2) {
        // Incomplete header - just stop parsing here
        logger.debug(`TLV8: Incomplete header at offset ${reader.currentOffset}`)
        break
      }

      const type = reader.readUInt8()
      const length = reader.readUInt8()

      // Check if we have enough data for the value
      if (reader.remaining < length) {
        // Incomplete value - rollback and stop
        logger.debug(`TLV8: Incomplete value at offset ${reader.currentOffset - 2}`)
        reader.currentOffset -= 2 // Rollback the header read
        break
      }

      const value = reader.readBuffer(length)
      items.push({ type, value })
    }

    return items
  }

  /**
   * Decode TLV8 data and defragment values that were split across multiple entries.
   * Returns a record mapping TLV types to their complete Buffer values.
   */
  static decodeObject(data: Buffer): TlvData {
    const items = TLV8.decode(data)
    const result: TlvData = {}

    for (const item of items) {
      if (item.type in result) {
        // Concatenate fragmented values
        result[item.type] = Buffer.concat([result[item.type]!, item.value])
      } else {
        result[item.type] = item.value
      }
    }

    return result
  }

  /**
   * Try to decode TLV8 data, returning partial results if incomplete.
   * This is useful for handling frames that may arrive in multiple parts.
   *
   * @param data - The TLV8 encoded data (may be incomplete)
   * @returns Object with parsed data and information about completeness
   */
  static tryDecodeObject(data: Buffer): {
    data: TlvData
    isComplete: boolean
    bytesProcessed: number
    errors: string[]
  } {
    const reader = new BufferReader(data)
    const result: TlvData = {}
    const errors: string[] = []

    while (reader.hasMore) {
      // Save position for potential rollback
      const startPos = reader.currentOffset

      // Check for complete header
      if (reader.remaining < 2) {
        errors.push(`Incomplete TLV header at offset ${startPos}`)
        break
      }

      const type = reader.readUInt8()
      const length = reader.readUInt8()

      // Check for complete value
      if (reader.remaining < length) {
        errors.push(`Incomplete TLV value at offset ${startPos + 2}, need ${length} bytes`)
        reader.currentOffset = startPos // Rollback
        break
      }

      const value = reader.readBuffer(length)

      // Concatenate fragmented values
      if (type in result) {
        result[type] = Buffer.concat([result[type]!, value])
      } else {
        result[type] = value
      }
    }

    const bytesProcessed = reader.currentOffset
    const isComplete = bytesProcessed === data.length

    if (!isComplete && bytesProcessed === 0) {
      errors.push('Unable to parse any complete TLV entries')
    }

    return {
      data: result,
      isComplete,
      bytesProcessed,
      errors,
    }
  }

  /**
   * Encode a TLV data object into a Buffer.
   * Handles fragmentation automatically for large values.
   */
  static encodeObject(obj: TlvData): Buffer {
    // Pre-calculate approximate size to avoid resizing
    let estimatedSize = 0
    for (const value of Object.values(obj)) {
      estimatedSize += value.length + Math.ceil(value.length / 255) * 2
    }

    const writer = new BufferWriter(estimatedSize)

    for (const [typeStr, value] of Object.entries(obj)) {
      const type = parseInt(typeStr, 10)
      if (isNaN(type) || type < 0 || type > 255) {
        throw new Tlv8Error(`Invalid TLV type: ${typeStr}`)
      }

      // Encode directly into the writer
      if (value.length === 0) {
        writer.writeUInt8(type)
        writer.writeUInt8(0)
      } else {
        let offset = 0
        while (offset < value.length) {
          const chunkSize = Math.min(255, value.length - offset)
          writer.writeUInt8(type)
          writer.writeUInt8(chunkSize)
          writer.writeBuffer(value.subarray(offset, offset + chunkSize))
          offset += chunkSize
        }
      }
    }

    return writer.toBuffer()
  }
}

/**
 * Helper function to encode TLV8 object (backward compatibility)
 */
export function encodeTLV8Object(obj: TlvData): Buffer {
  return TLV8.encodeObject(obj)
}

/**
 * Helper function to decode TLV8 object (backward compatibility)
 */
export function decodeTLV8Object(data: Buffer): TlvData {
  return TLV8.decodeObject(data)
}

/**
 * Get a human-readable name for a TLV type
 */
function getTlvTypeName(type: number): string {
  const entries = Object.entries(TlvValue) as [string, number][]
  for (const [key, value] of entries) {
    if (value === type) {
      return key
    }
  }
  return `0x${type.toString(16).padStart(2, '0')}`
}

/**
 * Get a human-readable name for an enum value
 */
function getEnumValueName(value: number, enumObj: Record<string, number>): string {
  const entry = Object.entries(enumObj).find(([, v]) => v === value)
  return entry ? entry[0] : `0x${value.toString(16)}`
}

/**
 * Create a human-readable string representation of TLV8 data.
 * Parses known types like Method, SeqNo, Error, and BackOff.
 */
export function stringify(data: TlvData): string {
  const parts: string[] = []

  for (const [typeStr, value] of Object.entries(data)) {
    const type = parseInt(typeStr, 10)
    const typeName = getTlvTypeName(type)

    switch (type) {
      case TlvValue.Method: {
        const method = value.readUInt8(0)
        const methodEnum: Record<string, number> = {}
        for (const [key, val] of Object.entries(Method)) {
          if (typeof val === 'number') {
            methodEnum[key] = val
          }
        }
        const methodName = getEnumValueName(method, methodEnum)
        parts.push(`${typeName}=${methodName}`)
        break
      }

      case TlvValue.SeqNo: {
        const seqno = value.readUInt8(0)
        const stateEnum: Record<string, number> = {}
        for (const [key, val] of Object.entries(State)) {
          if (typeof val === 'number') {
            stateEnum[key] = val
          }
        }
        const stateName = getEnumValueName(seqno, stateEnum)
        parts.push(`${typeName}=${stateName}`)
        break
      }

      case TlvValue.Error: {
        const code = value.readUInt8(0)
        const errorEnum: Record<string, number> = {}
        for (const [key, val] of Object.entries(ErrorCode)) {
          if (typeof val === 'number') {
            errorEnum[key] = val
          }
        }
        const errorName = getEnumValueName(code, errorEnum)
        parts.push(`${typeName}=${errorName}`)
        break
      }

      case TlvValue.BackOff: {
        // BackOff is encoded as little-endian integer
        let seconds = 0
        for (let i = 0; i < Math.min(value.length, 4); i++) {
          const byte = value[i]
          if (byte !== undefined) {
            seconds += byte << (i * 8)
          }
        }
        parts.push(`${typeName}=${seconds}s`)
        break
      }

      default: {
        parts.push(`${typeName}=${value.length}bytes`)
        break
      }
    }
  }

  return parts.join(', ')
}

/**
 * Convenience builder class for creating TLV8 data for common HAP operations.
 * Provides a fluent API for building HAP protocol messages.
 *
 * @example
 * ```typescript
 * const message = new TlvBuilder()
 *   .method(Method.PairSetup)
 *   .seqNo(State.M1)
 *   .publicKey(Buffer.from('client-key'))
 *   .build();
 * ```
 */
export class TlvBuilder {
  private data: TlvData = {}
  private estimatedSize = 0

  /**
   * Add a TLV entry with the specified type and value
   *
   * @param type - The TLV type (number or TlvValue enum)
   * @param value - The value to add (Buffer, Uint8Array, or single byte number)
   * @returns This builder instance for chaining
   */
  add(type: number | TlvValue, value: Buffer | Uint8Array | number): this {
    const typeNum = typeof type === 'number' ? type : (type as number)

    if (typeof value === 'number') {
      this.data[typeNum] = Buffer.from([value])
      this.estimatedSize += 3 // type + length + 1 byte
    } else {
      const buffer = Buffer.from(value)
      this.data[typeNum] = buffer
      this.estimatedSize += buffer.length + Math.ceil(buffer.length / 255) * 2
    }

    return this
  }

  /**
   * Add a method type
   */
  method(method: Method): this {
    return this.add(TlvValue.Method, method)
  }

  /**
   * Add a sequence number (state)
   */
  seqNo(state: State): this {
    return this.add(TlvValue.SeqNo, state)
  }

  /**
   * Add an error code
   */
  error(error: ErrorCode): this {
    return this.add(TlvValue.Error, error)
  }

  /**
   * Add encrypted data
   */
  encryptedData(data: Buffer | Uint8Array): this {
    return this.add(TlvValue.EncryptedData, data)
  }

  /**
   * Add a public key
   */
  publicKey(key: Buffer | Uint8Array): this {
    return this.add(TlvValue.PublicKey, key)
  }

  /**
   * Add a proof/signature
   */
  proof(proof: Buffer | Uint8Array): this {
    return this.add(TlvValue.Proof, proof)
  }

  /**
   * Add salt
   */
  salt(salt: Buffer | Uint8Array): this {
    return this.add(TlvValue.Salt, salt)
  }

  /**
   * Add identifier
   */
  identifier(id: Buffer | Uint8Array | string): this {
    const idBuffer = typeof id === 'string' ? Buffer.from(id, 'utf8') : Buffer.from(id)
    return this.add(TlvValue.Identifier, idBuffer)
  }

  /**
   * Build and return the TLV8 encoded buffer
   *
   * @returns The encoded TLV8 data as Buffer
   */
  build(): Buffer {
    return TLV8.encodeObject(this.data)
  }

  /**
   * Get the raw TLV data object
   */
  getData(): TlvData {
    return { ...this.data }
  }

  /**
   * Clear all data
   */
  clear(): this {
    this.data = {}
    return this
  }
}
