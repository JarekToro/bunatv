/**
 * TLV8 tests mirroring pyatv's test_hap_tlv8.py exactly
 * These tests ensure 100% compatibility with pyatv's TLV8 implementation
 */

import { describe, expect, it } from "bun:test";
import { stringify, TLV8, TlvValue } from "@/core/encoding/tlv8.ts";

// Test data constants mirroring pyatv's test_hap_tlv8.py
const SINGLE_KEY_IN = { 10: Buffer.from([0x31, 0x32, 0x33]) }; // {10: b"123"}
const SINGLE_KEY_OUT = Buffer.from([0x0a, 0x03, 0x31, 0x32, 0x33]); // b"\x0a\x03\x31\x32\x33"

const DOUBLE_KEY_IN = {
  1: Buffer.from([0x31, 0x31, 0x31]),
  4: Buffer.from([0x32, 0x32, 0x32]),
}; // OrderedDict([(1, b"111"), (4, b"222")])
const DOUBLE_KEY_OUT = Buffer.from([
  0x01, 0x03, 0x31, 0x31, 0x31, 0x04, 0x03, 0x32, 0x32, 0x32,
]); // b"\x01\x03\x31\x31\x31\x04\x03\x32\x32\x32"

const LARGE_KEY_IN = { 2: Buffer.alloc(256, 0x31) }; // {2: b"\x31" * 256}
const LARGE_KEY_OUT = Buffer.concat([
  Buffer.from([0x02, 0xff]), // First fragment header
  Buffer.alloc(255, 0x31), // First fragment data (255 bytes of 0x31)
  Buffer.from([0x02, 0x01, 0x31]), // Second fragment (1 byte of 0x31)
]); // b"\x02\xff" + b"\x31" * 255 + b"\x02\x01\x31"

describe("PyATV TLV8 Compatibility Tests", () => {
  describe("write_tlv (TLV8.encodeObject)", () => {
    it("test_write_single_key", () => {
      const result = TLV8.encodeObject(SINGLE_KEY_IN);
      expect(result).toEqual(SINGLE_KEY_OUT);
    });

    it("test_write_two_keys", () => {
      const result = TLV8.encodeObject(DOUBLE_KEY_IN);
      expect(result).toEqual(DOUBLE_KEY_OUT);
    });

    it("test_write_key_larger_than_255_bytes", () => {
      // This will actually result in two serialized TLVs, one being 255 bytes
      // and the next one will contain the remaining one byte
      const result = TLV8.encodeObject(LARGE_KEY_IN);
      expect(result).toEqual(LARGE_KEY_OUT);
    });
  });

  describe("read_tlv (TLV8.decodeObject)", () => {
    it("test_read_single_key", () => {
      const result = TLV8.decodeObject(SINGLE_KEY_OUT);
      expect(result).toEqual(SINGLE_KEY_IN);
    });

    it("test_read_two_keys", () => {
      const result = TLV8.decodeObject(DOUBLE_KEY_OUT);
      expect(result).toEqual(DOUBLE_KEY_IN);
    });

    it("test_read_key_larger_than_255_bytes", () => {
      const result = TLV8.decodeObject(LARGE_KEY_OUT);
      expect(result).toEqual(LARGE_KEY_IN);
    });
  });

  describe("stringify function", () => {
    it("test_stringify_method", () => {
      const result1 = stringify({ [TlvValue.Method]: Buffer.from([0x00]) });
      expect(result1).toBe("Method=PairSetup");

      const result2 = stringify({ [TlvValue.Method]: Buffer.from([0x02]) });
      expect(result2).toBe("Method=PairVerify");
    });

    it("test_stringify_seqno", () => {
      expect(stringify({ [TlvValue.SeqNo]: Buffer.from([0x01]) })).toBe(
        "SeqNo=M1"
      );
      expect(stringify({ [TlvValue.SeqNo]: Buffer.from([0x02]) })).toBe(
        "SeqNo=M2"
      );
      expect(stringify({ [TlvValue.SeqNo]: Buffer.from([0x03]) })).toBe(
        "SeqNo=M3"
      );
      expect(stringify({ [TlvValue.SeqNo]: Buffer.from([0x04]) })).toBe(
        "SeqNo=M4"
      );
      expect(stringify({ [TlvValue.SeqNo]: Buffer.from([0x05]) })).toBe(
        "SeqNo=M5"
      );
      expect(stringify({ [TlvValue.SeqNo]: Buffer.from([0x06]) })).toBe(
        "SeqNo=M6"
      );
    });

    it("test_stringify_error", () => {
      const result1 = stringify({ [TlvValue.Error]: Buffer.from([0x02]) });
      expect(result1).toBe("Error=Authentication");

      const result2 = stringify({ [TlvValue.Error]: Buffer.from([0x05]) });
      expect(result2).toBe("Error=MaxTries");
    });

    it("test_stringify_backoff", () => {
      const result = stringify({
        [TlvValue.BackOff]: Buffer.from([0x02, 0x00]),
      });
      expect(result).toBe("BackOff=2s");
    });

    it("test_stringify_remaining_short", () => {
      const values = [
        TlvValue.Identifier,
        TlvValue.Salt,
        TlvValue.PublicKey,
        TlvValue.Proof,
        TlvValue.EncryptedData,
        TlvValue.Certificate,
        TlvValue.Signature,
        TlvValue.Permissions,
        TlvValue.FragmentData,
        TlvValue.FragmentLast,
      ];

      for (const value of values) {
        const result = stringify({
          [value]: Buffer.from([0x00, 0x01, 0x02, 0x03]),
        });
        expect(result).toBe(`${getTlvValueName(value)}=4bytes`);
      }
    });

    it("test_stringify_multiple", () => {
      const data = {
        [TlvValue.Method]: Buffer.from([0x00]),
        [TlvValue.SeqNo]: Buffer.from([0x01]),
        [TlvValue.Error]: Buffer.from([0x03]),
        [TlvValue.BackOff]: Buffer.from([0x01, 0x00]),
      };

      const result = stringify(data);
      expect(result).toBe(
        "Method=PairSetup, SeqNo=M1, Error=BackOff, BackOff=1s"
      );
    });

    it("test_stringify_unknown_values", () => {
      const data = {
        [TlvValue.Method]: Buffer.from([0xaa]),
        [TlvValue.SeqNo]: Buffer.from([0xab]),
        [TlvValue.Error]: Buffer.from([0xac]),
        0xad: Buffer.from([0x01, 0x02, 0x03]),
      };

      const result = stringify(data);
      expect(result).toBe("Method=0xaa, SeqNo=0xab, Error=0xac, 0xad=3bytes");
    });
  });

  describe("Round-trip compatibility verification", () => {
    it("should match pyatv behavior for all test cases", () => {
      // Test all the pyatv cases in round-trip fashion
      const testCases = [SINGLE_KEY_IN, DOUBLE_KEY_IN, LARGE_KEY_IN];

      for (const original of testCases) {
        const encoded = TLV8.encodeObject(original);
        const decoded = TLV8.decodeObject(encoded);
        expect(decoded).toEqual(original);
      }
    });

    it("should handle edge cases like pyatv", () => {
      // Empty object
      const empty = {};
      const encodedEmpty = TLV8.encodeObject(empty);
      expect(encodedEmpty).toEqual(Buffer.alloc(0));
      const decodedEmpty = TLV8.decodeObject(encodedEmpty);
      expect(decodedEmpty).toEqual(empty);

      // Single empty value
      const emptyValue = { 42: Buffer.alloc(0) };
      const encodedEmptyValue = TLV8.encodeObject(emptyValue);
      const decodedEmptyValue = TLV8.decodeObject(encodedEmptyValue);
      expect(decodedEmptyValue).toEqual(emptyValue);
    });
  });

  describe("Error handling compatibility", () => {
    it("should handle incomplete data like pyatv (gracefully)", () => {
      // Incomplete header
      const incompleteHeader = Buffer.from([0x01]);
      const result1 = TLV8.tryDecodeObject(incompleteHeader);
      expect(result1.isComplete).toBe(false);
      expect(result1.data).toEqual({});

      // Length exceeds available data
      const insufficientData = Buffer.from([0x01, 0x10, 0x42]); // Claims 16 bytes, only 1 available
      const result2 = TLV8.tryDecodeObject(insufficientData);
      expect(result2.isComplete).toBe(false);
      expect(result2.data).toEqual({});
    });

    it("should process partial valid data like pyatv", () => {
      // Mix of valid and incomplete TLV entries
      const partialData = Buffer.concat([
        Buffer.from([0x01, 0x02, 0x41, 0x42]), // Valid: type=1, len=2, "AB"
        Buffer.from([0x02, 0x10]), // Incomplete: type=2, len=16, no value
      ]);

      const result = TLV8.tryDecodeObject(partialData);
      expect(result.isComplete).toBe(false);
      expect(result.bytesProcessed).toBe(4); // Only first TLV processed
      expect(result.data[0x01]).toEqual(Buffer.from([0x41, 0x42]));
      expect(result.data[0x02]).toBeUndefined();
    });
  });
});

/**
 * Helper function to get TlvValue enum name from value
 * Mimics the .name property access in Python
 */
function getTlvValueName(value: TlvValue): string {
  const names: Record<TlvValue, string> = {
    [TlvValue.Method]: "Method",
    [TlvValue.Identifier]: "Identifier",
    [TlvValue.Salt]: "Salt",
    [TlvValue.PublicKey]: "PublicKey",
    [TlvValue.Proof]: "Proof",
    [TlvValue.EncryptedData]: "EncryptedData",
    [TlvValue.SeqNo]: "SeqNo",
    [TlvValue.Error]: "Error",
    [TlvValue.BackOff]: "BackOff",
    [TlvValue.Certificate]: "Certificate",
    [TlvValue.Signature]: "Signature",
    [TlvValue.Permissions]: "Permissions",
    [TlvValue.FragmentData]: "FragmentData",
    [TlvValue.FragmentLast]: "FragmentLast",
    [TlvValue.Name]: "Name",
    [TlvValue.Flags]: "Flags",
  };

  return names[value] || `0x${value.toString(16)}`;
}
