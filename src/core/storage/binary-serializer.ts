/**
 * Binary Data Serialization Utilities
 *
 * Handles serialization/deserialization of various binary formats (Buffer, Uint8Array, etc.)
 * for JSON storage. Converts binary data to base64 strings and preserves original types.
 */

export type BinaryType =
  | 'Buffer'
  | 'Uint8Array'
  | 'ArrayBuffer'
  | 'Uint16Array'
  | 'Uint32Array'
  | 'Int8Array'
  | 'Int16Array'
  | 'Int32Array'

interface SerializedBinary {
  __binary: true
  type: BinaryType
  data: string // base64 encoded
}

/**
 * Check if a value is any type of binary data
 */
function isBinaryData(value: any): boolean {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    value instanceof Uint16Array ||
    value instanceof Uint32Array ||
    value instanceof Int8Array ||
    value instanceof Int16Array ||
    value instanceof Int32Array ||
    Buffer.isBuffer(value)
  )
}

/**
 * Serialize data, converting binary types to base64 strings
 */
export function serializeBinary(data: any): any {
  // Handle Node Buffer
  if (Buffer.isBuffer(data)) {
    return {
      __binary: true,
      type: 'Buffer' as BinaryType,
      data: data.toString('base64'),
    }
  }

  // Handle ArrayBuffer
  if (data instanceof ArrayBuffer) {
    return {
      __binary: true,
      type: 'ArrayBuffer' as BinaryType,
      data: Buffer.from(data).toString('base64'),
    }
  }

  // Handle Uint8Array (most common in crypto)
  if (data instanceof Uint8Array) {
    return {
      __binary: true,
      type: 'Uint8Array' as BinaryType,
      data: Buffer.from(data).toString('base64'),
    }
  }

  // Handle Uint16Array
  if (data instanceof Uint16Array) {
    return {
      __binary: true,
      type: 'Uint16Array' as BinaryType,
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    }
  }

  // Handle Uint32Array
  if (data instanceof Uint32Array) {
    return {
      __binary: true,
      type: 'Uint32Array' as BinaryType,
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    }
  }

  // Handle Int8Array
  if (data instanceof Int8Array) {
    return {
      __binary: true,
      type: 'Int8Array' as BinaryType,
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    }
  }

  // Handle Int16Array
  if (data instanceof Int16Array) {
    return {
      __binary: true,
      type: 'Int16Array' as BinaryType,
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    }
  }

  // Handle Int32Array
  if (data instanceof Int32Array) {
    return {
      __binary: true,
      type: 'Int32Array' as BinaryType,
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    }
  }

  // Recursively handle arrays
  if (Array.isArray(data)) {
    return data.map(serializeBinary)
  }

  // Recursively handle plain objects
  if (data && typeof data === 'object' && data.constructor === Object) {
    const result: any = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializeBinary(value)
    }
    return result
  }

  // Return primitives and other types as-is
  return data
}

/**
 * Deserialize data, converting base64 strings back to original binary types
 */
export function deserializeBinary(data: any): any {
  if (data && typeof data === 'object' && data.__binary === true) {
    const buffer = Buffer.from(data.data, 'base64')

    switch (data.type) {
      case 'Buffer':
        return buffer

      case 'ArrayBuffer':
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

      case 'Uint8Array':
        return new Uint8Array(buffer)

      case 'Uint16Array':
        return new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)

      case 'Uint32Array':
        return new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)

      case 'Int8Array':
        return new Int8Array(buffer)

      case 'Int16Array':
        return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)

      case 'Int32Array':
        return new Int32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)

      default:
        // Fallback to Uint8Array for unknown types
        return new Uint8Array(buffer)
    }
  }

  // Recursively handle arrays
  if (Array.isArray(data)) {
    return data.map(deserializeBinary)
  }

  // Recursively handle plain objects
  if (data && typeof data === 'object' && data.constructor === Object && !data.__binary) {
    const result: any = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = deserializeBinary(value)
    }
    return result
  }

  return data
}

/**
 * Helper to validate that data survives round-trip serialization
 */
export function validateRoundTrip(original: any): boolean {
  try {
    const serialized = serializeBinary(original)
    const deserialized = deserializeBinary(serialized)

    // Special handling for binary data comparison
    if (isBinaryData(original)) {
      const origBytes = new Uint8Array(original.buffer || original)
      const deserBytes = new Uint8Array(deserialized.buffer || deserialized)

      if (origBytes.length !== deserBytes.length) {
        return false
      }

      return origBytes.every((byte, i) => byte === deserBytes[i])
    }

    // For non-binary data, use JSON comparison
    return JSON.stringify(original) === JSON.stringify(deserialized)
  } catch (error) {
    return false
  }
}

/**
 * Check if an object contains serialized binary data
 */
export function containsBinaryData(data: any): boolean {
  if (data && typeof data === 'object' && data.__binary === true) {
    return true
  }

  if (Array.isArray(data)) {
    return data.some(containsBinaryData)
  }

  if (data && typeof data === 'object' && data.constructor === Object) {
    return Object.values(data).some(containsBinaryData)
  }

  return false
}
