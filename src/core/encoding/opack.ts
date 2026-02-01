/**
 * OPACK (ObjectPack) binary message encoding/decoding for HAP pairing
 *
 * OPACK is a binary serialization format (similar to MessagePack) used to wrap
 * TLV8 data in HAP pairing messages. This is NOT JSON - it's a compact binary
 * format that Apple TV requires for Companion protocol communication.
 *
 * ## OPACK Message Structure
 *
 * Pairing messages contain these binary-encoded fields:
 * - `_pd`: TLV8 binary data (Method + SeqNo + other HAP fields)
 * - `_pwTy`: Integer 1 (PIN authentication type)
 * - `_x`: Random transaction ID integer
 *
 * Verify messages contain:
 * - `_pd`: TLV8 binary data
 * - `_auTy`: Integer 4 (Ed25519 authentication type)
 * - `_x`: Random transaction ID integer
 *
 * ## Binary Format Details
 * - Dictionaries: 0xE0-0xEF prefix + key-value pairs
 * - Strings: 0x40-0x64 prefix + UTF-8 data
 * - Bytes: 0x70-0x94 prefix + raw binary data
 * - Small integers: 0x08-0x27 (value = byte - 0x08)
 * - Larger integers: 0x30-0x33 prefix + little-endian data
 *
 * ## Implementation Notes
 * This implementation matches pyatv's opack.py exactly to ensure compatibility.
 * The Apple TV will ignore messages that don't use proper binary OPACK encoding.
 *
 * @example
 * ```typescript
 * // Create M1 pairing message
 * const tlv8Data = new TlvBuilder()
 *   .method(Method.PairSetup)
 *   .seqNo(State.M1)
 *   .build();
 *
 * const opackMessage = OPACK.createPairingMessage(tlv8Data);
 * // Result: Binary OPACK data matching pyatv format
 * ```
 */

import { createLogger } from "../../logging/logging.ts";
import { BufferWriter, BufferReader, BufferPool } from "./buffer-utils.ts";

const logger = createLogger("bunatv:encoding:opack");

const opackPool = new BufferPool({
  sizeBuckets: [4, 8, 16, 32, 64, 128, 256, 512, 1024],
  maxPerBucket: 5, // OPACK messages are typically small
  clearOnRelease: false, // No sensitive data in sizes
});

/**
 * OPACK message structure for pairing
 */
export interface OPACKPairingMessage {
  /** Pairing data (TLV8 encoded) */
  _pd: Buffer;
  /** PIN authentication type (1 for pairing) */
  _pwTy: 1;
  /** Transaction ID */
  _x: number;
}

/**
 * OPACK message structure for verify
 */
export interface OPACKVerifyMessage {
  /** Pairing data (TLV8 encoded) */
  _pd: Buffer;
  /** Ed25519 authentication type (4 for verify) */
  _auTy: 4;
  /** Transaction ID */
  _x: number;
}

/**
 * Union type for all OPACK message types
 */
export type OPACKMessage = OPACKPairingMessage | OPACKVerifyMessage;

/**
 * OPACK encoding error
 */
export class OPACKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OPACKError";
  }
}

/**
 * OPACK binary message encoder/decoder utility
 *
 * Implements the exact binary OPACK format used by pyatv to ensure
 * compatibility with Apple TV devices.
 */
export class OPACK {
  /**
   * Encode a JavaScript object to binary OPACK format
   *
   * @param obj - The object to encode
   * @returns Encoded OPACK data as Buffer
   * @throws {OPACKError} When encoding fails
   */
  static encode(obj: Record<string, any>): Buffer {
    try {
      logger.debug(
        `OPACK.encode: Encoding object with ${Object.keys(obj).length} keys`
      );

      const objectList: Buffer[] = [];
      const result = OPACK.packValue(obj, objectList);

      logger.debug(`OPACK.encode: Encoded buffer length: ${result.length}`);
      return result;
    } catch (error) {
      throw new OPACKError(
        `OPACK encoding failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Pack a value to binary OPACK format
   * Implements object reference optimization matching pyatv behavior
   */
  private static packValue(data: any, objectList: Buffer[]): Buffer {
    if (data === null || data === undefined) {
      return Buffer.from([0x04]);
    }

    if (typeof data === "boolean") {
      return Buffer.from([data ? 0x01 : 0x02]);
    }

    if (typeof data === "bigint") {
      return OPACK.packBigInt(data);
    }

    if (typeof data === "number" && Number.isInteger(data)) {
      return OPACK.packInteger(data);
    }
    if (typeof data === "number" && !Number.isInteger(data)) {
      return OPACK.packFloat(data);
    }

    if (typeof data === "string") {
      const packed = OPACK.packString(data);
      return OPACK.checkAndReuseObject(packed, objectList);
    }

    if (Buffer.isBuffer(data)) {
      const packed = OPACK.packBytes(data);
      return OPACK.checkAndReuseObject(packed, objectList);
    }

    if (Array.isArray(data)) {
      return OPACK.packArray(data, objectList);
    }

    if (typeof data === "object") {
      return OPACK.packDict(data, objectList);
    }

    throw new Error(`Unsupported type: ${typeof data}`);
  }

  /**
   * Check if a packed value already exists in object list and return reference if so
   * Otherwise add to list for future reference
   * Matches pyatv's object referencing behavior
   */
  private static checkAndReuseObject(
    packedBytes: Buffer,
    objectList: Buffer[]
  ): Buffer {
    // Don't reference single-byte values (not worth it)
    if (packedBytes.length <= 1) {
      return packedBytes;
    }

    // Check if this value was already encoded
    const existingIndex = objectList.findIndex((obj) =>
      obj.equals(packedBytes)
    );

    if (existingIndex !== -1) {
      // Found a match! Return a reference instead
      if (existingIndex < 0x21) {
        // Small index: single byte 0xA0 + index
        return Buffer.from([0xa0 + existingIndex]);
      } else if (existingIndex <= 0xff) {
        // 1-byte index
        return Buffer.from([0xc1, existingIndex]);
      } else if (existingIndex <= 0xffff) {
        // 2-byte index (little-endian)
        const buf = Buffer.allocUnsafe(3);
        buf[0] = 0xc2;
        buf.writeUInt16LE(existingIndex, 1);
        return buf;
      } else if (existingIndex <= 0xffffffff) {
        // 4-byte index (little-endian)
        const buf = Buffer.allocUnsafe(5);
        buf[0] = 0xc3;
        buf.writeUInt32LE(existingIndex, 1);
        return buf;
      }
      // If index is too large, just encode normally (extremely rare)
    }

    // Not found or too large index - add to object list for future reference
    objectList.push(packedBytes);

    return packedBytes;
  }

  /**
   * Decode binary OPACK data to JavaScript object
   *
   * @param data - The OPACK encoded data
   * @returns Decoded JavaScript object
   * @throws {OPACKError} When decoding fails
   */
  static decode(data: Buffer): Record<string, any> {
    try {
      logger.debug(`OPACK.decode: Decoding ${data.length} bytes`);

      const reader = new BufferReader(data);
      const objectList: any[] = [];
      const result = OPACK.unpackValue(reader, objectList);

      if (Object.keys(result).length == 0) {
        Bun.file("empty_opack.bin").write(data).catch();
      }
      logger.debug(
        `OPACK.decode: Decoded object with ${Object.keys(result).length} keys: ${data.length} bytes`
      );
      return result;
    } catch (error) {
      throw new OPACKError(
        `OPACK decoding failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Pack integer to OPACK format
   */
  private static packInteger(value: number): Buffer {
    if (value >= 0 && value < 0x28) {
      // Small positive integers: 0x08 + value
      return Buffer.from([value + 0x08]);
    }

    const writer = new BufferWriter(5, opackPool);

    if (value >= 0 && value <= 0xff) {
      // 1-byte integer: 0x30 + value
      writer.writeUInt8(0x30);
      writer.writeUInt8(value);
    } else if (value >= 0 && value <= 0xffff) {
      // 2-byte integer: 0x31 + value (little-endian)
      writer.writeUInt8(0x31);
      writer.writeUInt16LE(value);
    } else if (value >= 0 && value <= 0xffffffff) {
      // 4-byte integer: 0x32 + value (little-endian)
      writer.writeUInt8(0x32);
      writer.writeUInt32LE(value >>> 0);
    } else {
      throw new Error(`Integer too large: ${value}`);
    }

    return writer.toBuffer();
  }

  /**
   * Pack float to OPACK format
   */
  private static packFloat(value: number): Buffer {
    const writer = new BufferWriter(8, opackPool);
    writer.writeUInt8(0x36); // Float64 prefix
    writer.writeFloat64(value);
    return writer.toBuffer();
  }

  /**
   * Pack BigInt to OPACK format (64-bit encoding)
   * Always uses 0x33 prefix + 8 bytes little-endian
   * @param value - BigInt value to encode (must fit in 64 bits)
   * @throws {Error} If value is negative or exceeds 64-bit range
   */
  private static packBigInt(value: bigint): Buffer {
    // Validate: Must be non-negative and fit in 8 bytes (64-bit)
    const MAX_64BIT = 0xffffffffffffffffn;
    if (value < 0n) {
      throw new Error(`BigInt out of range: ${value} (cannot be negative)`);
    }
    if (value > MAX_64BIT) {
      throw new Error(
        `BigInt out of range: ${value} (must be 0 to 0xFFFFFFFFFFFFFFFF)`
      );
    }

    // Encode as 0x33 + 8 bytes little-endian
    const writer = new BufferWriter(9, opackPool);
    writer.writeUInt8(0x33);

    // Write 8 bytes in little-endian order
    for (let i = 0; i < 8; i++) {
      writer.writeUInt8(Number((value >> BigInt(i * 8)) & 0xffn));
    }

    return writer.toBuffer();
  }

  /**
   * Pack string to OPACK format
   */
  private static packString(str: string): Buffer {
    const encoded = Buffer.from(str, "utf8");
    const len = encoded.length;

    if (len <= 0x20) {
      // Short string: 0x40 + length
      const buffer = opackPool.acquire(1 + len);
      buffer[0] = 0x40 + len;
      encoded.copy(buffer, 1);
      return buffer.subarray(0, 1 + len);
    }

    const writer = new BufferWriter(len + 3, opackPool);

    if (len <= 0xff) {
      writer.writeUInt8(0x61);
      writer.writeUInt8(len);
    } else if (len <= 0xffff) {
      writer.writeUInt8(0x62);
      writer.writeUInt16LE(len);
    } else {
      throw new Error(`String too long: ${len}`);
    }

    writer.writeBuffer(encoded);
    return writer.toBuffer();
  }

  /**
   * Pack bytes to OPACK format
   */
  private static packBytes(data: Buffer): Buffer {
    const len = data.length;

    if (len <= 0x20) {
      // Short bytes: 0x70 + length
      return Buffer.concat([Buffer.from([0x70 + len]), data]);
    }

    if (len <= 0xff) {
      // 1-byte length: 0x91 + length + data
      return Buffer.concat([Buffer.from([0x91, len]), data]);
    }

    if (len <= 0xffff) {
      // 2-byte length: 0x92 + length + data
      const lenBuf = Buffer.allocUnsafe(2);
      lenBuf.writeUInt16LE(len, 0);
      return Buffer.concat([Buffer.from([0x92]), lenBuf, data]);
    }

    throw new Error(`Bytes too long: ${len}`);
  }

  /**
   * Pack array to OPACK format
   */
  private static packArray(data: any[], objectList: Buffer[]): Buffer {
    const len = Math.min(data.length, 0xf);

    const writer = new BufferWriter(256, opackPool);
    writer.writeUInt8(0xd0 + len);

    // Pack all elements
    for (const item of data) {
      const itemBuffer = OPACK.packValue(item, objectList);
      writer.writeBuffer(itemBuffer);
    }

    // Add terminator for long arrays
    if (data.length >= 0xf) {
      writer.writeUInt8(0x03);
    }

    return writer.toBuffer();
  }

  /**
   * Pack dictionary to OPACK format
   */
  private static packDict(
    data: Record<string, any>,
    objectList: Buffer[]
  ): Buffer {
    const entries = Object.entries(data);
    const len = Math.min(entries.length, 0xf);

    // Use BufferWriter for efficient concatenation
    const writer = new BufferWriter(256, opackPool);
    writer.writeUInt8(0xe0 + len);

    // Pack all key-value pairs
    for (const [key, value] of entries) {
      const keyBuffer = OPACK.packValue(key, objectList);
      const valueBuffer = OPACK.packValue(value, objectList);
      writer.writeBuffer(keyBuffer);
      writer.writeBuffer(valueBuffer);
    }

    // Add terminator for long dicts
    if (entries.length >= 0xf) {
      writer.writeUInt8(0x03);
    }

    return writer.toBuffer();
  }

  private static unpackValue(reader: BufferReader, objectList: any[]): any {
    if (!reader.hasMore) {
      throw new Error("Buffer underrun");
    }

    const byte = reader.readUInt8();
    let value: any = null;
    let addToObjectList = true;

    // Invalid/reserved
    if (byte === 0x00) {
      throw new Error("Invalid OPACK byte: 0x00 is reserved");
    }

    // Boolean values
    else if (byte === 0x01) {
      addToObjectList = false;
      return true;
    } else if (byte === 0x02) {
      addToObjectList = false;
      return false;
    }

    // Terminator (handled at end)
    else if (byte === 0x03) {
      addToObjectList = false;
      return null;
    }

    // Null/undefined values
    else if (byte === 0x04) {
      addToObjectList = false;
      return null;
    }

    // UUID (0x05) - 16 bytes, big-endian
    else if (byte === 0x05) {
      const uuidBytes = reader.readBuffer(16);
      // Convert to standard UUID string format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const hex = uuidBytes.toString("hex");
      value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }

    // Absolute time (0x06) - 8 bytes, little-endian (treated as integer for now)
    else if (byte === 0x06) {
      const low = reader.readUInt32LE();
      const high = reader.readUInt32LE();
      value = Number((BigInt(high) << BigInt(32)) | BigInt(low));
    }

    // Integer -1
    else if (byte === 0x07) {
      addToObjectList = false;
      return -1;
    }

    // Small integers: 0x08-0x2F (values 0-39)
    else if (byte >= 0x08 && byte <= 0x2f) {
      addToObjectList = false;
      return byte - 0x08;
    }

    // Larger integers (0x30-0x34)
    // Size calculation: 2^(byte & 0xF) where byte is 0x30-0x34
    // 0x30 = 2^0 = 1, 0x31 = 2^1 = 2, 0x32 = 2^2 = 4, 0x33 = 2^3 = 8, 0x34 = 2^4 = 16 bytes
    else if (byte >= 0x30 && byte <= 0x34) {
      const sizeBytes = 1 << (byte & 0x0f); // 2^(byte & 0xF)
      if (sizeBytes === 1) value = reader.readUInt8();
      else if (sizeBytes === 2) value = reader.readUInt16LE();
      else if (sizeBytes === 4) value = reader.readUInt32LE();
      else if (sizeBytes === 8) {
        // Read as two 32-bit integers and combine as BigInt (no precision loss)
        const low = reader.readUInt32LE();
        const high = reader.readUInt32LE();
        value = (BigInt(high) << 32n) | BigInt(low);
      } else if (sizeBytes === 16) {
        // 16-byte integer - read as BigInt
        const bytes = reader.readBuffer(16);
        // Convert little-endian bytes to BigInt
        let result = BigInt(0);
        for (let i = 0; i < 16; i++) {
          result |= BigInt(bytes[i]!) << BigInt(i * 8);
        }
        value = result; // Return as BigInt to preserve precision
      } else throw new Error(`Unsupported integer size: ${sizeBytes}`);
    }

    // Float32 (0x35) - 4 bytes
    else if (byte === 0x35) {
      const buffer = reader.readBuffer(4);
      value = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength
      ).getFloat32(0, true); // little-endian
    }

    // Float64 (0x36) - 8 bytes
    else if (byte === 0x36) {
      const buffer = reader.readBuffer(8);
      value = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength
      ).getFloat64(0, true); // little-endian
    }

    // Short strings: 0x40-0x60
    else if (byte >= 0x40 && byte <= 0x60) {
      const len = byte - 0x40;
      value = reader.readBuffer(len).toString("utf8");
    }

    // Longer strings with explicit length (0x61-0x64)
    // Length bytes: byte & 0xF (1, 2, 3, or 4 bytes for length field)
    else if (byte >= 0x61 && byte <= 0x64) {
      const sizeBytes = byte & 0x0f;
      let len = 0;
      if (sizeBytes === 1) len = reader.readUInt8();
      else if (sizeBytes === 2) len = reader.readUInt16LE();
      else if (sizeBytes === 3) {
        // 3-byte length (little-endian)
        len =
          reader.readUInt8() |
          (reader.readUInt8() << 8) |
          (reader.readUInt8() << 16);
      } else if (sizeBytes === 4) len = reader.readUInt32LE();

      value = reader.readBuffer(len).toString("utf8");
    }

    // Short bytes: 0x70-0x90
    else if (byte >= 0x70 && byte <= 0x90) {
      const len = byte - 0x70;
      value = reader.readBuffer(len);
    }

    // Null-terminated string (0x6F)
    else if (byte === 0x6f) {
      const bytes: number[] = [];
      while (reader.hasMore) {
        const b = reader.readUInt8();
        if (b === 0) break;
        bytes.push(b);
      }
      value = Buffer.from(bytes).toString("utf8");
    }

    // Longer bytes with explicit length (0x91-0x94)
    // Size calculation: 1 << ((byte & 0xF) - 1)
    // 0x91 = 1<<0 = 1 byte, 0x92 = 1<<1 = 2 bytes, 0x93 = 1<<2 = 4 bytes, 0x94 = 1<<3 = 8 bytes
    else if (byte >= 0x91 && byte <= 0x94) {
      const sizeBytes = 1 << ((byte & 0x0f) - 1);
      let len = 0;
      if (sizeBytes === 1) len = reader.readUInt8();
      else if (sizeBytes === 2) len = reader.readUInt16LE();
      else if (sizeBytes === 4) len = reader.readUInt32LE();
      else if (sizeBytes === 8) {
        // Read as two 32-bit integers and combine for 64-bit length
        const low = reader.readUInt32LE();
        const high = reader.readUInt32LE();
        len = Number((BigInt(high) << BigInt(32)) | BigInt(low));
      }

      value = reader.readBuffer(len);
    }

    // Object references: 0xA0-0xC0 (small index)
    else if (byte >= 0xa0 && byte <= 0xc0) {
      const index = byte - 0xa0;
      if (index >= objectList.length) {
        throw new Error(
          `Invalid object reference: index ${index} out of bounds (list size: ${objectList.length})`
        );
      }
      addToObjectList = false;
      return objectList[index];
    }

    // Object references: 0xC1-0xC4 (extended index)
    else if (byte >= 0xc1 && byte <= 0xc4) {
      const sizeBytes = byte - 0xc0;
      let index = 0;
      if (sizeBytes === 1) index = reader.readUInt8();
      else if (sizeBytes === 2) index = reader.readUInt16LE();
      else if (sizeBytes === 4) index = reader.readUInt32LE();
      else throw new Error(`Unsupported object reference size: ${sizeBytes}`);

      if (index >= objectList.length) {
        throw new Error(
          `Invalid object reference: index ${index} out of bounds (list size: ${objectList.length})`
        );
      }
      addToObjectList = false;
      return objectList[index];
    }

    // Arrays: 0xD0-0xDF
    else if (byte >= 0xd0 && byte <= 0xdf) {
      const count = byte - 0xd0;
      const result: any[] = [];

      if (count === 0xf) {
        // Endless array format: read until terminator (0x03)
        while (reader.hasMore && reader.peek(1)[0] !== 0x03) {
          result.push(OPACK.unpackValue(reader, objectList));
        }
        // Skip the terminator
        if (reader.hasMore) {
          reader.skip(1);
        }
      } else {
        // Fixed-count array: read exactly 'count' items
        for (let i = 0; i < count; i++) {
          result.push(OPACK.unpackValue(reader, objectList));
        }
      }

      addToObjectList = false;
      return result;
    }

    // Dictionaries: 0xE0-0xEF
    else if (byte >= 0xe0 && byte <= 0xef) {
      const count = byte - 0xe0;
      const result: Record<string, any> = {};

      if (count === 0xf) {
        // Endless dictionary format: read until terminator (0x03)
        while (reader.hasMore && reader.peek(1)[0] !== 0x03) {
          const key = OPACK.unpackValue(reader, objectList);
          const value = OPACK.unpackValue(reader, objectList);
          result[key] = value;
        }
        // Skip the terminator
        if (reader.hasMore) {
          reader.skip(1);
        }
      } else {
        // Fixed-count dictionary: read exactly 'count' entries
        for (let i = 0; i < count; i++) {
          const key = OPACK.unpackValue(reader, objectList);
          const value = OPACK.unpackValue(reader, objectList);
          result[key] = value;
        }
      }

      addToObjectList = false;
      return result;
    } else {
      throw new Error(
        `Unpack not implemented for byte: 0x${byte.toString(16).padStart(2, "0")}`
      );
    }

    // Add value to object list for future references (if applicable)
    if (addToObjectList && value !== null && value !== undefined) {
      objectList.push(value);
    }

    return value;
  }

  /**
   * Extract TLV8 data from OPACK message
   *
   * @param opackData - The OPACK encoded message
   * @returns The TLV8 data buffer
   * @throws {OPACKError} When message format is invalid
   */
  static extractTLV8Data(opackData: Buffer): Buffer {
    const obj = OPACK.decode(opackData);

    if (!obj._pd) {
      throw new OPACKError("OPACK message missing _pd field");
    }

    if (!Buffer.isBuffer(obj._pd)) {
      // Handle case where _pd might be a base64 string or array
      if (typeof obj._pd === "string") {
        return Buffer.from(obj._pd, "base64");
      } else if (Array.isArray(obj._pd)) {
        return Buffer.from(obj._pd);
      } else {
        throw new OPACKError("OPACK _pd field is not a valid buffer format");
      }
    }

    return obj._pd;
  }

  static cleanup(): void {
    // Clear the pool periodically to free memory
    // Could be called after each pairing session
    opackPool.clear();
  }
}

export class OPACKMESSAGE {
  /**
   * Create OPACK pairing message with TLV8 data
   *
   * @param tlv8Data - The TLV8 encoded pairing data
   * @param transactionId - Optional transaction ID (random if not provided)
   * @returns OPACK encoded pairing message
   */
  static createPairingMessage(
    tlv8Data: Buffer,
    transactionId?: number
  ): Buffer {
    logger.debug(
      `createPairingMessage: Creating pairing message with ${tlv8Data.length} bytes of TLV8 data`
    );

    const txId = transactionId ?? Math.floor(Math.random() * 65536);

    const opackMessage: OPACKPairingMessage = {
      _pd: tlv8Data,
      _pwTy: 1, // PIN authentication type
      _x: txId, // Transaction ID
    };

    return OPACK.encode(opackMessage);
  }

  /**
   * Create OPACK verify message with TLV8 data
   *
   * @param tlv8Data - The TLV8 encoded verify data
   * @param transactionId - Optional transaction ID (random if not provided)
   * @returns OPACK encoded verify message
   */
  static createVerifyMessage(tlv8Data: Buffer, transactionId?: number): Buffer {
    logger.debug(
      `createVerifyMessage: Creating verify message with ${tlv8Data.length} bytes of TLV8 data`
    );

    const txId = transactionId ?? Math.floor(Math.random() * 65536);

    const opackMessage: OPACKVerifyMessage = {
      _pd: tlv8Data,
      _auTy: 4, // Ed25519 authentication type
      _x: txId, // Transaction ID
    };

    return OPACK.encode(opackMessage);
  }

  /**
   * Check if an OPACK message is a pairing message
   *
   * @param opackData - The OPACK encoded message
   * @returns True if this is a pairing message
   */
  static isPairingMessage(opackData: Buffer): boolean {
    try {
      const obj = OPACK.decode(opackData);
      return obj._pwTy === 1;
    } catch {
      return false;
    }
  }

  /**
   * Check if an OPACK message is a verify message
   *
   * @param opackData - The OPACK encoded message
   * @returns True if this is a verify message
   */
  static isVerifyMessage(opackData: Buffer): boolean {
    try {
      const obj = OPACK.decode(opackData);
      return obj._auTy === 4;
    } catch {
      return false;
    }
  }
}
