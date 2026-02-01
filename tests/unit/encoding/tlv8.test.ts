/**
 * Unit tests for TLV8 encoding/decoding utilities
 */

import { describe, expect, it } from "bun:test";
import {
  decodeTLV8Object,
  encodeTLV8Object,
  ErrorCode,
  Flags,
  Method,
  State,
  stringify,
  TLV8,
  Tlv8Error,
  TlvBuilder,
  TlvValue,
} from "@/core/encoding/tlv8.ts";

describe("TLV8 Core Functionality", () => {
  describe("TLV8.encode", () => {
    it("should encode a single byte value", () => {
      const result = TLV8.encode(0x0a, Buffer.from([0x31, 0x32, 0x33]));
      const expected = Buffer.from([0x0a, 0x03, 0x31, 0x32, 0x33]);
      expect(result).toEqual(expected);
    });

    it("should encode an empty value", () => {
      const result = TLV8.encode(0x01, Buffer.alloc(0));
      const expected = Buffer.from([0x01, 0x00]);
      expect(result).toEqual(expected);
    });

    it("should fragment values larger than 255 bytes", () => {
      const largeValue = Buffer.alloc(256, 0x31);
      const result = TLV8.encode(0x02, largeValue);

      // Should create two fragments: 255 + 1 bytes
      const expectedFirst = Buffer.concat([
        Buffer.from([0x02, 0xff]),
        Buffer.alloc(255, 0x31),
      ]);
      const expectedSecond = Buffer.from([0x02, 0x01, 0x31]);
      const expected = Buffer.concat([expectedFirst, expectedSecond]);

      expect(result).toEqual(expected);
    });

    it("should throw error for invalid type", () => {
      expect(() => {
        TLV8.encode(256, Buffer.from([0x01]));
      }).toThrow(Tlv8Error);

      expect(() => {
        TLV8.encode(-1, Buffer.from([0x01]));
      }).toThrow(Tlv8Error);
    });
  });

  describe("TLV8.decode", () => {
    it("should decode a single TLV item", () => {
      const data = Buffer.from([0x0a, 0x03, 0x31, 0x32, 0x33]);
      const result = TLV8.decode(data);

      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe(0x0a);
      expect(result[0]!.value).toEqual(Buffer.from([0x31, 0x32, 0x33]));
    });

    it("should decode multiple TLV items", () => {
      const data = Buffer.from([
        0x01,
        0x03,
        0x31,
        0x31,
        0x31, // Type 1: "111"
        0x04,
        0x03,
        0x32,
        0x32,
        0x32, // Type 4: "222"
      ]);
      const result = TLV8.decode(data);

      expect(result).toHaveLength(2);
      expect(result[0]!.type).toBe(0x01);
      expect(result[0]!.value).toEqual(Buffer.from([0x31, 0x31, 0x31]));
      expect(result[1]!.type).toBe(0x04);
      expect(result[1]!.value).toEqual(Buffer.from([0x32, 0x32, 0x32]));
    });

    it("should decode empty values", () => {
      const data = Buffer.from([0x01, 0x00]);
      const result = TLV8.decode(data);

      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe(0x01);
      expect(result[0]!.value).toEqual(Buffer.alloc(0));
    });

    it("should handle incomplete header gracefully", () => {
      const data = Buffer.from([0x01]); // Missing length byte
      const result = TLV8.decode(data);
      expect(result).toEqual([]); // Returns empty array instead of throwing
    });

    it("should handle length exceeding buffer gracefully", () => {
      const data = Buffer.from([0x01, 0x05, 0x31, 0x32]); // Says 5 bytes but only 2 available
      const result = TLV8.decode(data);
      expect(result).toEqual([]); // Returns empty array instead of throwing
    });
  });

  describe("TLV8.decodeObject", () => {
    it("should decode a single TLV into object", () => {
      const data = Buffer.from([0x0a, 0x03, 0x31, 0x32, 0x33]);
      const result = TLV8.decodeObject(data);

      expect(result[0x0a]).toEqual(Buffer.from([0x31, 0x32, 0x33]));
    });

    it("should decode multiple TLVs into object", () => {
      const data = Buffer.from([
        0x01,
        0x03,
        0x31,
        0x31,
        0x31, // Type 1: "111"
        0x04,
        0x03,
        0x32,
        0x32,
        0x32, // Type 4: "222"
      ]);
      const result = TLV8.decodeObject(data);

      expect(result[0x01]).toEqual(Buffer.from([0x31, 0x31, 0x31]));
      expect(result[0x04]).toEqual(Buffer.from([0x32, 0x32, 0x32]));
    });

    it("should defragment split values", () => {
      const data = Buffer.from([
        0x02,
        0xff,
        ...Array(255).fill(0x31), // First fragment: 255 bytes of 0x31
        0x02,
        0x01,
        0x31, // Second fragment: 1 byte of 0x31
      ]);
      const result = TLV8.decodeObject(data);

      expect(result[0x02]).toHaveLength(256);
      expect(result[0x02]).toEqual(Buffer.alloc(256, 0x31));
    });
  });

  describe("TLV8.encodeObject", () => {
    it("should encode a single TLV object", () => {
      const obj = { 10: Buffer.from([0x31, 0x32, 0x33]) };
      const result = TLV8.encodeObject(obj);
      const expected = Buffer.from([0x0a, 0x03, 0x31, 0x32, 0x33]);

      expect(result).toEqual(expected);
    });

    it("should encode multiple TLV objects", () => {
      const obj = {
        1: Buffer.from([0x31, 0x31, 0x31]),
        4: Buffer.from([0x32, 0x32, 0x32]),
      };
      const result = TLV8.encodeObject(obj);

      // Note: Object.entries() order may vary, so decode and verify
      const decoded = TLV8.decodeObject(result);
      expect(decoded[1]).toEqual(Buffer.from([0x31, 0x31, 0x31]));
      expect(decoded[4]).toEqual(Buffer.from([0x32, 0x32, 0x32]));
    });

    it("should handle large values with automatic fragmentation", () => {
      const obj = { 2: Buffer.alloc(256, 0x31) };
      const result = TLV8.encodeObject(obj);

      // Should create fragmented output
      const decoded = TLV8.decodeObject(result);
      expect(decoded[2]).toHaveLength(256);
      expect(decoded[2]).toEqual(Buffer.alloc(256, 0x31));
    });

    it("should throw error for invalid type strings", () => {
      const obj = { invalid: Buffer.from([0x01]) };
      expect(() => TLV8.encodeObject(obj as any)).toThrow(Tlv8Error);
    });
  });

  describe("Round-trip encoding/decoding", () => {
    it("should preserve data through encode/decode cycle", () => {
      const originalData = {
        [TlvValue.Method]: Buffer.from([Method.PairSetup]),
        [TlvValue.SeqNo]: Buffer.from([State.M1]),
        [TlvValue.PublicKey]: Buffer.from([1, 2, 3, 4, 5]),
      };

      const encoded = TLV8.encodeObject(originalData);
      const decoded = TLV8.decodeObject(encoded);

      expect(decoded).toEqual(originalData);
    });

    it("should handle large values correctly", () => {
      const largeValue = Buffer.alloc(1000, 0xab);
      const originalData = { 42: largeValue };

      const encoded = TLV8.encodeObject(originalData);
      const decoded = TLV8.decodeObject(encoded);

      expect(decoded[42]).toEqual(largeValue);
    });
  });

  describe("TLV8.tryDecodeObject", () => {
    it("should handle complete data successfully", () => {
      const data = Buffer.from([0x01, 0x03, 0x31, 0x32, 0x33]);
      const result = TLV8.tryDecodeObject(data);

      expect(result.isComplete).toBe(true);
      expect(result.bytesProcessed).toBe(5);
      expect(result.errors).toEqual([]);
      expect(result.data[0x01]).toEqual(Buffer.from([0x31, 0x32, 0x33]));
    });

    it("should handle incomplete data gracefully", () => {
      const data = Buffer.from([0x01, 0x10, 0x42]); // Says 16 bytes but only 1 available
      const result = TLV8.tryDecodeObject(data);

      expect(result.isComplete).toBe(false);
      expect(result.bytesProcessed).toBe(0);
      expect(result.data).toEqual({});
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle partial valid data", () => {
      // First TLV is valid, second is incomplete
      const data = Buffer.from([
        0x01,
        0x02,
        0x41,
        0x42, // Valid: type=1, len=2, value="AB"
        0x02,
        0x10, // Incomplete: type=2, len=16, but no value
      ]);
      const result = TLV8.tryDecodeObject(data);

      expect(result.isComplete).toBe(false);
      expect(result.bytesProcessed).toBe(4); // Only first TLV processed
      expect(result.data[0x01]).toEqual(Buffer.from([0x41, 0x42]));
      expect(result.data[0x02]).toBeUndefined();
    });

    it("should handle empty data", () => {
      const result = TLV8.tryDecodeObject(Buffer.alloc(0));

      expect(result.isComplete).toBe(true);
      expect(result.bytesProcessed).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.data).toEqual({});
    });
  });
});

describe("Backward Compatibility Functions", () => {
  it("should work with encodeTLV8Object", () => {
    const obj = { 10: Buffer.from([1, 2, 3]) };
    const result1 = encodeTLV8Object(obj);
    const result2 = TLV8.encodeObject(obj);

    expect(result1).toEqual(result2);
  });

  it("should work with decodeTLV8Object", () => {
    const data = Buffer.from([0x0a, 0x03, 0x01, 0x02, 0x03]);
    const result1 = decodeTLV8Object(data);
    const result2 = TLV8.decodeObject(data);

    expect(result1).toEqual(result2);
  });
});

describe("stringify function", () => {
  it("should stringify Method values", () => {
    const data = { [TlvValue.Method]: Buffer.from([Method.PairSetup]) };
    expect(stringify(data)).toBe("Method=PairSetup");

    const data2 = { [TlvValue.Method]: Buffer.from([Method.PairVerify]) };
    expect(stringify(data2)).toBe("Method=PairVerify");
  });

  it("should stringify SeqNo values", () => {
    const data = { [TlvValue.SeqNo]: Buffer.from([State.M1]) };
    expect(stringify(data)).toBe("SeqNo=M1");

    const data2 = { [TlvValue.SeqNo]: Buffer.from([State.M6]) };
    expect(stringify(data2)).toBe("SeqNo=M6");
  });

  it("should stringify Error values", () => {
    const data = { [TlvValue.Error]: Buffer.from([ErrorCode.Authentication]) };
    expect(stringify(data)).toBe("Error=Authentication");

    const data2 = { [TlvValue.Error]: Buffer.from([ErrorCode.MaxTries]) };
    expect(stringify(data2)).toBe("Error=MaxTries");
  });

  it("should stringify BackOff values", () => {
    const data = { [TlvValue.BackOff]: Buffer.from([0x02, 0x00]) }; // 2 seconds little-endian
    expect(stringify(data)).toBe("BackOff=2s");
  });

  it("should stringify other values as byte length", () => {
    const data = {
      [TlvValue.PublicKey]: Buffer.from([1, 2, 3, 4]),
      [TlvValue.Signature]: Buffer.from([5, 6, 7]),
    };
    const result = stringify(data);

    expect(result).toContain("PublicKey=4bytes");
    expect(result).toContain("Signature=3bytes");
  });

  it("should stringify unknown values with hex notation", () => {
    const data = {
      [TlvValue.Method]: Buffer.from([0xaa]), // Unknown method
      [0xad]: Buffer.from([1, 2, 3]), // Unknown type
    };
    const result = stringify(data);

    expect(result).toContain("Method=0xaa");
    expect(result).toContain("0xad=3bytes");
  });

  it("should stringify multiple values", () => {
    const data = {
      [TlvValue.Method]: Buffer.from([Method.PairSetup]),
      [TlvValue.SeqNo]: Buffer.from([State.M1]),
      [TlvValue.Error]: Buffer.from([ErrorCode.BackOff]),
      [TlvValue.BackOff]: Buffer.from([0x01, 0x00]),
    };

    const result = stringify(data);
    expect(result).toBe(
      "Method=PairSetup, SeqNo=M1, Error=BackOff, BackOff=1s"
    );
  });
});

describe("TlvBuilder", () => {
  it("should build simple TLV data", () => {
    const builder = new TlvBuilder();
    const data = builder.method(Method.PairSetup).seqNo(State.M1).build();

    const decoded = TLV8.decodeObject(data);
    expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
    expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M1]));
  });

  it("should handle all convenience methods", () => {
    const builder = new TlvBuilder();
    const publicKey = Buffer.from([1, 2, 3, 4]);
    const salt = Buffer.from([5, 6, 7, 8]);
    const proof = Buffer.from([9, 10, 11, 12]);
    const encryptedData = Buffer.from([13, 14, 15, 16]);

    builder
      .method(Method.PairVerify)
      .seqNo(State.M2)
      .error(ErrorCode.Authentication)
      .publicKey(publicKey)
      .salt(salt)
      .proof(proof)
      .encryptedData(encryptedData)
      .identifier("test-device");

    const data = builder.getData();
    expect(data[TlvValue.Method]).toEqual(Buffer.from([Method.PairVerify]));
    expect(data[TlvValue.SeqNo]).toEqual(Buffer.from([State.M2]));
    expect(data[TlvValue.Error]).toEqual(
      Buffer.from([ErrorCode.Authentication])
    );
    expect(data[TlvValue.PublicKey]).toEqual(publicKey);
    expect(data[TlvValue.Salt]).toEqual(salt);
    expect(data[TlvValue.Proof]).toEqual(proof);
    expect(data[TlvValue.EncryptedData]).toEqual(encryptedData);
    expect(data[TlvValue.Identifier]).toEqual(
      Buffer.from("test-device", "utf8")
    );
  });

  it("should clear data when requested", () => {
    const builder = new TlvBuilder();
    builder.method(Method.PairSetup);

    expect(Object.keys(builder.getData())).toHaveLength(1);

    builder.clear();
    expect(Object.keys(builder.getData())).toHaveLength(0);
  });

  it("should allow adding raw values", () => {
    const builder = new TlvBuilder();
    builder.add(TlvValue.Certificate, Buffer.from([1, 2, 3]));
    builder.add(42, 0x55); // Add single byte value

    const data = builder.getData();
    expect(data[TlvValue.Certificate]).toEqual(Buffer.from([1, 2, 3]));
    expect(data[42]).toEqual(Buffer.from([0x55]));
  });
});

describe("Enum Values", () => {
  it("should have correct TlvValue enum values", () => {
    expect(TlvValue.Method).toBe(0x00);
    expect(TlvValue.Identifier).toBe(0x01);
    expect(TlvValue.Salt).toBe(0x02);
    expect(TlvValue.PublicKey).toBe(0x03);
    expect(TlvValue.Proof).toBe(0x04);
    expect(TlvValue.EncryptedData).toBe(0x05);
    expect(TlvValue.SeqNo).toBe(0x06);
    expect(TlvValue.Error).toBe(0x07);
    expect(TlvValue.BackOff).toBe(0x08);
    expect(TlvValue.Certificate).toBe(0x09);
    expect(TlvValue.Signature).toBe(0x0a);
    expect(TlvValue.Permissions).toBe(0x0b);
    expect(TlvValue.FragmentData).toBe(0x0c);
    expect(TlvValue.FragmentLast).toBe(0x0d);
    expect(TlvValue.Name).toBe(0x11);
    expect(TlvValue.Flags).toBe(0x13);
  });

  it("should have correct Method enum values", () => {
    expect(Method.PairSetup).toBe(0x00);
    expect(Method.PairSetupWithAuth).toBe(0x01);
    expect(Method.PairVerify).toBe(0x02);
    expect(Method.AddPairing).toBe(0x03);
    expect(Method.RemovePairing).toBe(0x04);
    expect(Method.ListPairing).toBe(0x05);
  });

  it("should have correct State enum values", () => {
    expect(State.M1).toBe(0x01);
    expect(State.M2).toBe(0x02);
    expect(State.M3).toBe(0x03);
    expect(State.M4).toBe(0x04);
    expect(State.M5).toBe(0x05);
    expect(State.M6).toBe(0x06);
  });

  it("should have correct ErrorCode enum values", () => {
    expect(ErrorCode.Unknown).toBe(0x01);
    expect(ErrorCode.Authentication).toBe(0x02);
    expect(ErrorCode.BackOff).toBe(0x03);
    expect(ErrorCode.MaxPeers).toBe(0x04);
    expect(ErrorCode.MaxTries).toBe(0x05);
    expect(ErrorCode.Unavailable).toBe(0x06);
    expect(ErrorCode.Busy).toBe(0x07);
  });

  it("should have correct Flags enum values", () => {
    expect(Flags.TransientPairing).toBe(0x10);
  });
});

describe("Edge Cases and Error Handling", () => {
  it("should handle zero-byte buffer gracefully", () => {
    const emptyBuffer = Buffer.alloc(0);
    const result = TLV8.decodeObject(emptyBuffer);
    expect(result).toEqual({});
  });

  it("should handle maximum size fragments correctly", () => {
    // Test exact boundary: 255-byte fragments
    const exactSize = Buffer.alloc(255, 0x42);
    const encoded = TLV8.encode(0x01, exactSize);

    // Should be encoded as single fragment
    expect(encoded).toHaveLength(255 + 2); // data + type + length
    expect(encoded[0]).toBe(0x01); // type
    expect(encoded[1]).toBe(255); // length

    const decoded = TLV8.decodeObject(encoded);
    expect(decoded[0x01]).toEqual(exactSize);
  });

  it("should handle very large values with many fragments", () => {
    // Test 1000-byte value (requires 4 fragments: 255+255+255+235)
    const largeValue = Buffer.alloc(1000, 0x55);
    const encoded = TLV8.encode(0x02, largeValue);

    // Should create 4 fragments
    const expectedFragments = Math.ceil(1000 / 255);
    expect(expectedFragments).toBe(4);

    const decoded = TLV8.decodeObject(encoded);
    expect(decoded[0x02]).toEqual(largeValue);
    expect(decoded[0x02]).toHaveLength(1000);
  });

  it("should validate type boundaries correctly", () => {
    const validBuffer = Buffer.from([1, 2, 3]);

    // Valid boundary values
    expect(() => TLV8.encode(0, validBuffer)).not.toThrow();
    expect(() => TLV8.encode(255, validBuffer)).not.toThrow();

    // Invalid boundary values
    expect(() => TLV8.encode(-1, validBuffer)).toThrow(
      "TLV type must be 0-255, got -1"
    );
    expect(() => TLV8.encode(256, validBuffer)).toThrow(
      "TLV type must be 0-255, got 256"
    );
  });

  it("should handle various malformed TLV data gracefully", () => {
    // Buffer with only one byte (incomplete header) - now handled gracefully
    const incompleteHeader = TLV8.decode(Buffer.from([0x01]));
    expect(incompleteHeader).toEqual([]);

    // Buffer claiming more data than available - now handled gracefully
    const insufficientData = TLV8.decode(Buffer.from([0x01, 0x10, 0x42]));
    expect(insufficientData).toEqual([]);

    // Completely empty buffer
    const emptyResult = TLV8.decode(Buffer.alloc(0));
    expect(emptyResult).toEqual([]);
  });

  it("should handle string identifiers in TlvBuilder", () => {
    const builder = new TlvBuilder();
    const stringId = "device-identifier-123";

    builder.identifier(stringId);
    const data = builder.getData();

    expect(data[TlvValue.Identifier]).toEqual(Buffer.from(stringId, "utf8"));
  });

  it("should handle buffer vs Uint8Array inputs in TlvBuilder", () => {
    const builder = new TlvBuilder();
    const bufferData = Buffer.from([1, 2, 3, 4]);
    const uint8Data = new Uint8Array([5, 6, 7, 8]);

    builder.publicKey(bufferData);
    builder.salt(uint8Data);

    const data = builder.getData();
    expect(data[TlvValue.PublicKey]).toEqual(bufferData);
    expect(data[TlvValue.Salt]).toEqual(Buffer.from(uint8Data));
  });

  it("should handle BackOff encoding edge cases", () => {
    // Test different BackOff values
    const testCases = [
      { seconds: 0, expected: [0x00, 0x00, 0x00, 0x00] },
      { seconds: 1, expected: [0x01, 0x00, 0x00, 0x00] },
      { seconds: 255, expected: [0xff, 0x00, 0x00, 0x00] },
      { seconds: 256, expected: [0x00, 0x01, 0x00, 0x00] },
      { seconds: 65535, expected: [0xff, 0xff, 0x00, 0x00] },
    ];

    testCases.forEach(({ seconds, expected }) => {
      const data = { [TlvValue.BackOff]: Buffer.from(expected) };
      const result = stringify(data);
      expect(result).toBe(`BackOff=${seconds}s`);
    });
  });
});
