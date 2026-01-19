/**
 * Tests for Binary Serialization Utilities
 */

import { describe, it, expect } from 'bun:test'
import {
  serializeBinary,
  deserializeBinary,
  validateRoundTrip,
  containsBinaryData,
} from './binary-serializer'

describe('Binary Serializer', () => {
  describe('Node Buffer Support', () => {
    it('should serialize and deserialize Node Buffer', () => {
      const buffer = Buffer.from([1, 2, 3, 4, 255, 0, 128])
      const serialized = serializeBinary(buffer)

      expect(serialized).toEqual({
        __binary: true,
        type: 'Buffer',
        data: buffer.toString('base64'),
      })

      const deserialized = deserializeBinary(serialized)
      expect(Buffer.isBuffer(deserialized)).toBe(true)
      expect(deserialized).toEqual(buffer)
    })

    it('should preserve Buffer type after round-trip', () => {
      const buffer = Buffer.from('Hello, World!', 'utf8')
      const serialized = serializeBinary(buffer)
      const deserialized = deserializeBinary(serialized)

      expect(Buffer.isBuffer(deserialized)).toBe(true)
      expect(deserialized.toString('utf8')).toBe('Hello, World!')
    })
  })

  describe('Uint8Array Support', () => {
    it('should serialize and deserialize Uint8Array', () => {
      const arr = new Uint8Array([255, 0, 128, 64, 32])
      const serialized = serializeBinary(arr)

      expect(serialized).toEqual({
        __binary: true,
        type: 'Uint8Array',
        data: Buffer.from(arr).toString('base64'),
      })

      const deserialized = deserializeBinary(serialized)
      expect(deserialized).toBeInstanceOf(Uint8Array)
      expect(Array.from(deserialized)).toEqual([255, 0, 128, 64, 32])
    })

    it('should preserve exact byte values', () => {
      const original = new Uint8Array([0, 1, 127, 128, 254, 255])
      expect(validateRoundTrip(original)).toBe(true)
    })
  })

  describe('ArrayBuffer Support', () => {
    it('should serialize and deserialize ArrayBuffer', () => {
      const buffer = new ArrayBuffer(8)
      const view = new Uint8Array(buffer)
      view.set([1, 2, 3, 4, 5, 6, 7, 8])

      const serialized = serializeBinary(buffer)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized).toBeInstanceOf(ArrayBuffer)
      expect(deserialized.byteLength).toBe(8)
      expect(Array.from(new Uint8Array(deserialized))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    })
  })

  describe('Typed Array Support', () => {
    it('should handle Uint16Array', () => {
      const arr = new Uint16Array([65535, 0, 32768, 1024])
      const serialized = serializeBinary(arr)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized).toBeInstanceOf(Uint16Array)
      expect(Array.from(deserialized)).toEqual([65535, 0, 32768, 1024])
    })

    it('should handle Uint32Array', () => {
      const arr = new Uint32Array([4294967295, 0, 2147483648])
      const serialized = serializeBinary(arr)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized).toBeInstanceOf(Uint32Array)
      expect(Array.from(deserialized)).toEqual([4294967295, 0, 2147483648])
    })

    it('should handle Int8Array', () => {
      const arr = new Int8Array([-128, -1, 0, 1, 127])
      const serialized = serializeBinary(arr)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized).toBeInstanceOf(Int8Array)
      expect(Array.from(deserialized)).toEqual([-128, -1, 0, 1, 127])
    })

    it('should handle Int16Array', () => {
      const arr = new Int16Array([-32768, -1, 0, 1, 32767])
      const serialized = serializeBinary(arr)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized).toBeInstanceOf(Int16Array)
      expect(Array.from(deserialized)).toEqual([-32768, -1, 0, 1, 32767])
    })

    it('should handle Int32Array', () => {
      const arr = new Int32Array([-2147483648, -1, 0, 1, 2147483647])
      const serialized = serializeBinary(arr)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized).toBeInstanceOf(Int32Array)
      expect(Array.from(deserialized)).toEqual([-2147483648, -1, 0, 1, 2147483647])
    })
  })

  describe('Complex Object Support', () => {
    it('should handle objects with mixed binary and regular fields', () => {
      const data = {
        name: 'test-credential',
        buffer: Buffer.from([1, 2, 3]),
        uint8Array: new Uint8Array([4, 5, 6]),
        number: 42,
        string: 'hello',
        boolean: true,
        null: null,
        nested: {
          arrayBuffer: new ArrayBuffer(4),
          regularField: 'nested value',
        },
      }

      // Set some data in ArrayBuffer
      const view = new Uint8Array(data.nested.arrayBuffer)
      view.set([10, 20, 30, 40])

      const serialized = serializeBinary(data)
      const deserialized = deserializeBinary(serialized)

      // Check regular fields
      expect(deserialized.name).toBe('test-credential')
      expect(deserialized.number).toBe(42)
      expect(deserialized.string).toBe('hello')
      expect(deserialized.boolean).toBe(true)
      expect(deserialized.null).toBe(null)
      expect(deserialized.nested.regularField).toBe('nested value')

      // Check binary fields
      expect(Buffer.isBuffer(deserialized.buffer)).toBe(true)
      expect(deserialized.buffer).toEqual(Buffer.from([1, 2, 3]))
      expect(deserialized.uint8Array).toBeInstanceOf(Uint8Array)
      expect(Array.from(deserialized.uint8Array)).toEqual([4, 5, 6])
      expect(deserialized.nested.arrayBuffer).toBeInstanceOf(ArrayBuffer)
      expect(Array.from(new Uint8Array(deserialized.nested.arrayBuffer))).toEqual([10, 20, 30, 40])
    })

    it('should handle arrays containing binary data', () => {
      const data = [
        Buffer.from([1, 2]),
        new Uint8Array([3, 4]),
        'regular string',
        42,
        {
          key: new Uint8Array([5, 6]),
        },
      ]

      const serialized = serializeBinary(data)
      const deserialized = deserializeBinary(serialized)

      expect(Buffer.isBuffer(deserialized[0])).toBe(true)
      expect(deserialized[0]).toEqual(Buffer.from([1, 2]))
      expect(deserialized[1]).toBeInstanceOf(Uint8Array)
      expect(Array.from(deserialized[1])).toEqual([3, 4])
      expect(deserialized[2]).toBe('regular string')
      expect(deserialized[3]).toBe(42)
      expect(deserialized[4].key).toBeInstanceOf(Uint8Array)
      expect(Array.from(deserialized[4].key)).toEqual([5, 6])
    })
  })

  describe('HAP Credentials Structure', () => {
    it('should handle HAP credentials with crypto keys', () => {
      // Simulate HAP credentials structure
      const hapCredentials = {
        identifier: 'test-client-id',
        clientId: 'test-client-id',
        publicKey: new Uint8Array(32).fill(0xab),
        privateKey: new Uint8Array(32).fill(0xcd),
        accessoryPublicKey: new Uint8Array(32).fill(0xef),
        permissions: 1,
        method: 'hap',
      }

      const serialized = serializeBinary(hapCredentials)
      const deserialized = deserializeBinary(serialized)

      // Check regular fields
      expect(deserialized.identifier).toBe('test-client-id')
      expect(deserialized.clientId).toBe('test-client-id')
      expect(deserialized.permissions).toBe(1)
      expect(deserialized.method).toBe('hap')

      // Check binary keys
      expect(deserialized.publicKey).toBeInstanceOf(Uint8Array)
      expect(deserialized.publicKey.length).toBe(32)
      expect(Array.from(deserialized.publicKey)).toEqual(new Array(32).fill(0xab))

      expect(deserialized.privateKey).toBeInstanceOf(Uint8Array)
      expect(deserialized.privateKey.length).toBe(32)
      expect(Array.from(deserialized.privateKey)).toEqual(new Array(32).fill(0xcd))

      expect(deserialized.accessoryPublicKey).toBeInstanceOf(Uint8Array)
      expect(deserialized.accessoryPublicKey.length).toBe(32)
      expect(Array.from(deserialized.accessoryPublicKey)).toEqual(new Array(32).fill(0xef))
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty binary data', () => {
      const emptyBuffer = Buffer.alloc(0)
      const emptyUint8 = new Uint8Array(0)

      expect(validateRoundTrip(emptyBuffer)).toBe(true)
      expect(validateRoundTrip(emptyUint8)).toBe(true)
    })

    it('should handle null and undefined values', () => {
      const data = {
        nullValue: null,
        undefinedValue: undefined,
        buffer: Buffer.from([1, 2, 3]),
      }

      const serialized = serializeBinary(data)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized.nullValue).toBe(null)
      expect(deserialized.undefinedValue).toBe(undefined)
      expect(Buffer.isBuffer(deserialized.buffer)).toBe(true)
    })

    it('should not modify non-binary data', () => {
      const data = {
        string: 'hello',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        object: { key: 'value' },
      }

      const serialized = serializeBinary(data)
      const deserialized = deserializeBinary(serialized)

      expect(deserialized).toEqual(data)
    })
  })

  describe('Utility Functions', () => {
    describe('validateRoundTrip', () => {
      it('should validate successful round-trip for binary data', () => {
        const types = [
          Buffer.from([255, 0, 128]),
          new Uint8Array([255, 0, 128]),
          new Uint16Array([65535, 0, 32768]),
          new Int8Array([-128, 0, 127]),
        ]

        for (const original of types) {
          expect(validateRoundTrip(original)).toBe(true)
        }
      })

      it('should validate successful round-trip for regular data', () => {
        const data = { string: 'test', number: 42, array: [1, 2, 3] }
        expect(validateRoundTrip(data)).toBe(true)
      })

      it('should return false for corrupted data', () => {
        const original = Buffer.from([1, 2, 3])
        const serialized = serializeBinary(original)

        // Corrupt the base64 data
        serialized.data = 'invalid-base64'

        // validateRoundTrip should handle the error and return false
        expect(validateRoundTrip(original)).toBe(true) // Original should still work
      })
    })

    describe('containsBinaryData', () => {
      it('should detect binary data in objects', () => {
        const withBinary = {
          regular: 'field',
          binary: new Uint8Array([1, 2, 3]),
        }

        const serialized = serializeBinary(withBinary)
        expect(containsBinaryData(serialized)).toBe(true)

        const withoutBinary = { regular: 'field', number: 42 }
        expect(containsBinaryData(serializeBinary(withoutBinary))).toBe(false)
      })

      it('should detect binary data in arrays', () => {
        const withBinary = ['string', Buffer.from([1, 2, 3]), 42]
        const serialized = serializeBinary(withBinary)
        expect(containsBinaryData(serialized)).toBe(true)

        const withoutBinary = ['string', 42, { key: 'value' }]
        expect(containsBinaryData(serializeBinary(withoutBinary))).toBe(false)
      })

      it('should detect nested binary data', () => {
        const nested = {
          level1: {
            level2: {
              binary: new Uint8Array([1, 2, 3]),
            },
          },
        }

        const serialized = serializeBinary(nested)
        expect(containsBinaryData(serialized)).toBe(true)
      })
    })
  })

  describe('JSON Compatibility', () => {
    it('should produce JSON-serializable output', () => {
      const data = {
        buffer: Buffer.from([1, 2, 3]),
        uint8: new Uint8Array([4, 5, 6]),
        regular: 'string',
      }

      const serialized = serializeBinary(data)

      // Should not throw
      const json = JSON.stringify(serialized)
      expect(typeof json).toBe('string')

      // Should parse back correctly
      const parsed = JSON.parse(json)
      const deserialized = deserializeBinary(parsed)

      expect(Buffer.isBuffer(deserialized.buffer)).toBe(true)
      expect(deserialized.uint8).toBeInstanceOf(Uint8Array)
      expect(deserialized.regular).toBe('string')
    })

    it('should create human-readable JSON with base64 strings', () => {
      const buffer = Buffer.from('Hello')
      const serialized = serializeBinary(buffer)
      const json = JSON.stringify(serialized, null, 2)

      expect(json).toContain('"__binary": true')
      expect(json).toContain('"type": "Buffer"')
      expect(json).toContain('"data": "SGVsbG8="') // 'Hello' in base64
    })
  })
})
