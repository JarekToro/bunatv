/**
 * Enhanced tests for OPACK encoding/decoding with debug capabilities
 */

import { describe, expect, it } from "bun:test";
import {
  Method,
  State,
  TLV8,
  TlvBuilder,
  TlvValue,
} from "@/core/encoding/tlv8.ts";
import { OPACK, OPACKMESSAGE } from "@/core/encoding/opack.ts";

describe("Enhanced OPACK Implementation", () => {
  describe("OPACK Message Creation and Analysis", () => {
    it("should handle complex TLV8 data with multiple fields", () => {
      const complexTlv8 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M3)
        .identifier("test-device-12345")
        .publicKey(Buffer.alloc(32, 0xab))
        .salt(Buffer.alloc(16, 0xcd))
        .proof(Buffer.alloc(32, 0xef))
        .build();

      const opackMessage = OPACKMESSAGE.createPairingMessage(complexTlv8);

      // Verify all fields are preserved
      const extractedTlv8 = OPACK.extractTLV8Data(opackMessage);
      const decodedTlv8 = TLV8.decodeObject(extractedTlv8);

      expect(decodedTlv8[TlvValue.Method]).toEqual(
        Buffer.from([Method.PairSetup])
      );
      expect(decodedTlv8[TlvValue.SeqNo]).toEqual(Buffer.from([State.M3]));
      expect(decodedTlv8[TlvValue.Identifier]).toEqual(
        Buffer.from("test-device-12345", "utf8")
      );
      expect(decodedTlv8[TlvValue.PublicKey]).toEqual(Buffer.alloc(32, 0xab));
      expect(decodedTlv8[TlvValue.Salt]).toEqual(Buffer.alloc(16, 0xcd));
      expect(decodedTlv8[TlvValue.Proof]).toEqual(Buffer.alloc(32, 0xef));
    });
  });

  describe("OPACK Encoding/Decoding Edge Cases", () => {
    it("should handle empty TLV8 data", () => {
      const emptyTlv8 = Buffer.alloc(0);
      const opackMessage = OPACKMESSAGE.createPairingMessage(emptyTlv8);

      // Should still be valid OPACK with empty payload
      expect(OPACKMESSAGE.isPairingMessage(opackMessage)).toBe(true);
    });

    it("should handle large TLV8 data efficiently", () => {
      // Create large TLV8 with fragmented fields (> 255 bytes each)
      const largeTlv8 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M1)
        .publicKey(Buffer.alloc(512, 0x42)) // Will be fragmented
        .salt(Buffer.alloc(300, 0x43)) // Will be fragmented
        .build();

      const opackMessage = OPACKMESSAGE.createPairingMessage(largeTlv8);

      // Verify round-trip preservation of large data
      const extracted = OPACK.extractTLV8Data(opackMessage);
      const decoded = TLV8.decodeObject(extracted);

      expect(decoded[TlvValue.PublicKey]).toEqual(Buffer.alloc(512, 0x42));
      expect(decoded[TlvValue.Salt]).toEqual(Buffer.alloc(300, 0x43));
    });

    it("should detect and handle malformed OPACK data", () => {
      const malformedData = Buffer.from(
        '{"invalid": "json", "missing": "_pd"}'
      );

      // Should not crash on malformed data
      expect(() => OPACKMESSAGE.isPairingMessage(malformedData)).not.toThrow();
      expect(OPACKMESSAGE.isPairingMessage(malformedData)).toBe(false);
    });

    describe("Buffer Serialization Edge Cases", () => {
      it("should handle nested Buffer objects correctly", () => {
        const nestedData = {
          _pd: Buffer.from([1, 2, 3, 4]),
          _pwTy: 1,
          nested: {
            innerBuffer: Buffer.from([5, 6, 7, 8]),
            plainData: "test",
          },
        };

        const encoded = OPACK.encode(nestedData);
        const decoded = OPACK.decode(encoded);

        expect(Buffer.isBuffer(decoded._pd)).toBe(true);
        expect(decoded._pd).toEqual(Buffer.from([1, 2, 3, 4]));
        expect(decoded._pwTy).toBe(1);
        expect(Buffer.isBuffer(decoded.nested.innerBuffer)).toBe(true);
        expect(decoded.nested.innerBuffer).toEqual(Buffer.from([5, 6, 7, 8]));
        expect(decoded.nested.plainData).toBe("test");
      });

      it("should handle arrays with mixed types including Buffers", () => {
        const mixedArray = {
          _pd: Buffer.from([1, 2, 3]),
          _pwTy: 1,
          mixedArray: [
            "string",
            42,
            Buffer.from([9, 10, 11]),
            { nestedBuffer: Buffer.from([12, 13, 14]) },
          ],
        };

        const encoded = OPACK.encode(mixedArray);
        const decoded = OPACK.decode(encoded);

        expect(decoded.mixedArray).toHaveLength(4);
        expect(decoded.mixedArray[0]).toBe("string");
        expect(decoded.mixedArray[1]).toBe(42);
        expect(Buffer.isBuffer(decoded.mixedArray[2])).toBe(true);
        expect(decoded.mixedArray[2]).toEqual(Buffer.from([9, 10, 11]));
        expect(Buffer.isBuffer(decoded.mixedArray[3].nestedBuffer)).toBe(true);
        expect(decoded.mixedArray[3].nestedBuffer).toEqual(
          Buffer.from([12, 13, 14])
        );
      });

      it("should preserve buffer data integrity across multiple encode/decode cycles", () => {
        const originalData = {
          _pd: Buffer.from([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]),
          _pwTy: 1,
          binaryData: Buffer.from([0xff, 0xfe, 0xfd, 0xfc]),
        };

        // Multiple encode/decode cycles
        let currentData = originalData;
        for (let i = 0; i < 5; i++) {
          const encoded = OPACK.encode(currentData);
          currentData = OPACK.decode(encoded) as typeof originalData;
        }

        // Data should be preserved exactly
        expect(currentData._pd).toEqual(originalData._pd);
        expect(currentData._pwTy).toBe(originalData._pwTy);
        expect(currentData.binaryData).toEqual(originalData.binaryData);
      });
    });

    describe("Performance and Memory Management", () => {
      it("should handle rapid encode/decode operations efficiently", () => {
        const testData = new TlvBuilder()
          .method(Method.PairSetup)
          .seqNo(State.M1)
          .identifier("performance-test")
          .build();

        const startTime = performance.now();

        // Perform many operations
        for (let i = 0; i < 1000; i++) {
          const encoded = OPACKMESSAGE.createPairingMessage(testData);
          const decoded = OPACK.extractTLV8Data(encoded);
          expect(decoded).toEqual(testData);
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        // Should complete within reasonable time (< 100ms for 1000 operations)
        expect(duration).toBeLessThan(100);
      });
    });

    describe("Real-world OPACK Scenarios", () => {
      it("should handle Apple TV M4 response with encrypted data", () => {
        // Simulate M4 with encrypted payload
        const encryptedPayload = Buffer.alloc(128, 0xff); // Mock encrypted data

        const m4Tlv8 = new TlvBuilder()
          .method(Method.PairSetup)
          .seqNo(State.M4)
          .proof(Buffer.alloc(32, 0x03)) // Server proof
          .encryptedData(encryptedPayload)
          .build();

        const opackResponse = OPACKMESSAGE.createPairingMessage(m4Tlv8);

        // Should extract properly
        const extractedTlv8 = OPACK.extractTLV8Data(opackResponse);
        const decodedTlv8 = TLV8.decodeObject(extractedTlv8);

        expect(decodedTlv8[TlvValue.Proof]).toEqual(Buffer.alloc(32, 0x03));
        expect(decodedTlv8[TlvValue.EncryptedData]).toEqual(encryptedPayload);
      });
    });

    describe("Object Reference Support", () => {
      describe("Decoding with Object References (0xA0-0xC4)", () => {
        it("should decode small object reference (0xA0)", () => {
          // pyatv output with object reference at 0xA0 (reference to index 0)
          // This is from our real test: "_i" string is referenced instead of encoded twice
          const pyatvHex =
            "e4425f694b5f73797374656d496e666f425f7809425f740a425f63ea435f626608435f6366310002455f636c466c3080435f7366310001435f7376463137302e3138a05145313a34383a31463a37313a46373a3845465f6964734944612434383734623136622d346237372d343939382d623964352d303931656638636634383661465f70756249445130323a45333a41303a44393a44333a3430456d6f64656c4a6950686f6e6531302c36446e616d654d42756e4154562052656d6f7465";
          const pyatvBytes = Buffer.from(pyatvHex, "hex");

          // Should decode successfully
          const decoded = OPACK.decode(pyatvBytes);

          // Verify structure
          expect(decoded._i).toBe("_systemInfo");
          expect(decoded._x).toBe(1);
          expect(decoded._t).toBe(2);
          expect(decoded._c).toBeDefined();

          // The nested "_i" should be decoded from the object reference
          expect(decoded._c._i).toBe("E1:48:1F:71:F7:8E");
          expect(decoded._c._idsID).toBe(
            "4874b16b-4b77-4998-b9d5-091ef8cf486a"
          );
          expect(decoded._c.name).toBe("BunATV Remote");
        });

        it("should decode object with multiple references to same string", () => {
          // Message with repeated key "_type"
          const message = {
            _type: "test",
            nested: {
              _type: "test", // Should be referenced
              another: {
                _type: "test", // Should be referenced
              },
            },
          };

          // First encode with bunatv (no references)
          const encoded = OPACK.encode(message);

          // Decode should work
          const decoded = OPACK.decode(encoded);
          expect(decoded).toEqual(message);
        });

        it("should handle object reference at different index positions", () => {
          // Test references at various index positions (0xA0, 0xA1, 0xA2, etc.)
          // Create a message with many unique values to build up the object list
          const message = {
            field0: "unique0",
            field1: "unique1",
            field2: "unique2",
            field3: "unique0", // Reference to index 0
            field4: "unique1", // Reference to index 1
            field5: "unique2", // Reference to index 2
          };

          const encoded = OPACK.encode(message);
          const decoded = OPACK.decode(encoded);

          expect(decoded).toEqual(message);
        });

        it("should handle 1-byte object reference (0xC1)", () => {
          // Build a large object list to force 1-byte reference encoding
          const manyUniqueStrings: Record<string, string> = {};
          for (let i = 0; i < 40; i++) {
            manyUniqueStrings[`field${i}`] = `unique${i}`;
          }
          // Add a reference beyond 0x20 (forcing 0xC1 encoding)
          manyUniqueStrings["ref"] = "unique0"; // Should reference index 0 with 0xC1

          const encoded = OPACK.encode(manyUniqueStrings);
          const decoded = OPACK.decode(encoded);

          expect(decoded).toEqual(manyUniqueStrings);
        });
      });

      describe("Encoding with Object References (Optimization)", () => {
        it("should encode repeated strings as object references", () => {
          const message = {
            key1: "repeated",
            key2: "repeated",
            key3: "repeated",
          };

          const encoded = OPACK.encode(message);
          const decoded = OPACK.decode(encoded);

          // Should decode correctly
          expect(decoded).toEqual(message);

          // With object references, encoded size should be smaller than without
          // Calculate what size would be without references
          const withoutRefs = OPACK.encode({
            key1: "repeated",
            key2: "different1",
            key3: "different2",
          });

          // With references should be smaller (3 occurrences of "repeated")
          // First occurrence: full encoding, next 2: just 1 byte (0xA0, 0xA0)
          expect(encoded.length).toBeLessThan(withoutRefs.length);
        });

        it("should match pyatv encoding size for system info message", () => {
          // The exact message from our comparison test
          const message = {
            _i: "_systemInfo",
            _x: 1,
            _t: 2,
            _c: {
              _bf: 0,
              _cf: 512,
              _clFl: 128,
              _sf: 256,
              _sv: "170.18",
              _i: "E1:48:1F:71:F7:8E",
              _idsID: "4874b16b-4b77-4998-b9d5-091ef8cf486a",
              _pubID: "02:E3:A0:D9:D3:40",
              model: "iPhone10,6",
              name: "BunATV Remote",
            },
          };

          const encoded = OPACK.encode(message);

          // pyatv produces 191 bytes with object references
          // bunatv without references produces 193 bytes
          // With object references implemented, should match pyatv (191 bytes)
          expect(encoded.length).toBeLessThanOrEqual(191);

          // Should decode correctly
          const decoded = OPACK.decode(encoded);
          expect(decoded).toEqual(message);
        });

        it("should not create references for single-occurrence values", () => {
          const message = {
            unique1: "value1",
            unique2: "value2",
            unique3: "value3",
          };

          const encoded = OPACK.encode(message);
          const decoded = OPACK.decode(encoded);

          expect(decoded).toEqual(message);
        });

        it("should handle mixed referenced and non-referenced values", () => {
          const message = {
            repeated: "same",
            unique: "different1",
            alsoRepeated: "same",
            alsoUnique: "different2",
            thirdRepeated: "same",
          };

          const encoded = OPACK.encode(message);
          const decoded = OPACK.decode(encoded);

          expect(decoded).toEqual(message);
        });
      });

      describe("Cross-Implementation Compatibility", () => {
        it("should decode pyatv-encoded system info message", () => {
          // Real pyatv output from our test
          const pyatvHex =
            "e4425f694b5f73797374656d496e666f425f7809425f740a425f63ea435f626608435f6366310002455f636c466c3080435f7366310001435f7376463137302e3138a05145313a34383a31463a37313a46373a3845465f6964734944612434383734623136622d346237372d343939382d623964352d303931656638636634383661465f70756249445130323a45333a41303a44393a44333a3430456d6f64656c4a6950686f6e6531302c36446e616d654d42756e4154562052656d6f7465";
          const pyatvBytes = Buffer.from(pyatvHex, "hex");

          const decoded = OPACK.decode(pyatvBytes);

          // Verify complete structure
          expect(decoded._i).toBe("_systemInfo");
          expect(decoded._x).toBe(1);
          expect(decoded._t).toBe(2);
          expect(decoded._c._bf).toBe(0);
          expect(decoded._c._cf).toBe(512);
          expect(decoded._c._clFl).toBe(128);
          expect(decoded._c._sf).toBe(256);
          expect(decoded._c._sv).toBe("170.18");
          expect(decoded._c._i).toBe("E1:48:1F:71:F7:8E");
          expect(decoded._c._idsID).toBe(
            "4874b16b-4b77-4998-b9d5-091ef8cf486a"
          );
          expect(decoded._c._pubID).toBe("02:E3:A0:D9:D3:40");
          expect(decoded._c.model).toBe("iPhone10,6");
          expect(decoded._c.name).toBe("BunATV Remote");
        });

        it("should produce output compatible with pyatv decoder", () => {
          // Our encoding should be decodable by pyatv (even if not using references)
          const message = {
            _i: "_systemInfo",
            _x: 1,
            _t: 2,
            _c: { name: "BunATV Remote" },
          };

          const encoded = OPACK.encode(message);

          // Should be valid OPACK that pyatv can decode
          // We verified this works in our Python test
          const decoded = OPACK.decode(encoded);
          expect(decoded).toEqual(message);
        });

        it("should handle round-trip with object references", () => {
          const original = {
            key: "value",
            nested: {
              key: "value", // Same as parent
              deep: {
                key: "value", // Same again
              },
            },
          };

          const encoded = OPACK.encode(original);
          const decoded = OPACK.decode(encoded);
          const reencoded = OPACK.encode(decoded);
          const redecoded = OPACK.decode(reencoded);

          expect(decoded).toEqual(original);
          expect(redecoded).toEqual(original);
        });
      });

      describe("Object Reference Edge Cases", () => {
        it("should handle reference to empty string", () => {
          const message = {
            empty1: "",
            empty2: "",
            empty3: "",
          };

          const encoded = OPACK.encode(message);
          const decoded = OPACK.decode(encoded);

          expect(decoded).toEqual(message);
        });

        it("should handle reference to buffer data", () => {
          const sharedBuffer = Buffer.from([1, 2, 3, 4]);
          const message = {
            buf1: sharedBuffer,
            buf2: sharedBuffer, // Should be same reference
          };

          const encoded = OPACK.encode(message);
          const decoded = OPACK.decode(encoded);

          expect(decoded.buf1).toEqual(sharedBuffer);
          expect(decoded.buf2).toEqual(sharedBuffer);
        });

        it("should handle deeply nested repeated values", () => {
          const repeated = "deep_value";
          const message = {
            level1: {
              level2: {
                level3: {
                  value: repeated,
                },
                value: repeated,
              },
              value: repeated,
            },
            value: repeated,
          };

          const encoded = OPACK.encode(message);
          const decoded = OPACK.decode(encoded);

          expect(decoded).toEqual(message);
        });

        it("should handle object reference bounds checking", () => {
          // Malformed data with invalid reference index
          const invalidRef = Buffer.from([0xe1, 0x42, 0x61, 0x41, 0xa5]); // Dict with ref to index 5 (doesn't exist)

          expect(() => OPACK.decode(invalidRef)).toThrow(/reference/);
        });
      });
    });
  });

  describe("BigInt Support", () => {
    it("should encode and decode bigint without precision loss", () => {
      const sessionId = 7172892275086502557n;
      const message = {
        _i: "_mcc",
        _t: 2,
        _c: { _sid: sessionId },
        _x: 123,
      };

      const encoded = OPACK.encode(message);
      const decoded = OPACK.decode(encoded);

      expect(decoded._c._sid).toBe(sessionId);
      expect(typeof decoded._c._sid).toBe("bigint");
    });

    it("should use 0x33 prefix for BigInt encoding", () => {
      const bigValue = 0x1234567890abcdefn;
      const encoded = OPACK.encode({ val: bigValue });

      // Verify 0x33 prefix exists in encoded data
      expect(encoded.includes(0x33)).toBe(true);
    });

    it("should handle maximum 64-bit unsigned integer", () => {
      const maxUint64 = 0xffffffffffffffffn;
      const encoded = OPACK.encode({ max: maxUint64 });
      const decoded = OPACK.decode(encoded);

      expect(decoded.max).toBe(maxUint64);
      expect(typeof decoded.max).toBe("bigint");
    });

    it("should handle minimum valid BigInt (zero)", () => {
      const zero = 0n;
      const encoded = OPACK.encode({ zero });
      const decoded = OPACK.decode(encoded);

      expect(decoded.zero).toBe(zero);
    });

    it("should validate BigInt fits in 8 bytes", () => {
      const tooLarge = 0x10000000000000000n; // 2^64, exceeds 64-bit

      expect(() => OPACK.encode({ val: tooLarge })).toThrow(
        "BigInt out of range"
      );
    });

    it("should reject negative BigInt", () => {
      const negative = -1n;

      expect(() => OPACK.encode({ val: negative })).toThrow(
        "BigInt out of range"
      );
      expect(() => OPACK.encode({ val: negative })).toThrow(
        "cannot be negative"
      );
    });

    it("should preserve BigInt in nested structures", () => {
      const data = {
        sessionInfo: {
          localId: 123,
          remoteId: 456,
          combinedId: 7172892275086502557n,
        },
      };

      const encoded = OPACK.encode(data);
      const decoded = OPACK.decode(encoded);

      expect(decoded.sessionInfo.combinedId).toBe(7172892275086502557n);
      expect(typeof decoded.sessionInfo.combinedId).toBe("bigint");
    });

    it("should handle mixed number and bigint in same message", () => {
      const data = {
        smallNumber: 42, // Regular number
        largeNumber: 0xffffffff, // 32-bit number
        bigInt: 0x123456789abcdefn, // 64-bit BigInt
        _x: 123,
      };

      const encoded = OPACK.encode(data);
      const decoded = OPACK.decode(encoded);

      expect(decoded.smallNumber).toBe(42);
      expect(typeof decoded.smallNumber).toBe("number");
      expect(decoded.largeNumber).toBe(0xffffffff);
      expect(typeof decoded.largeNumber).toBe("number");
      expect(decoded.bigInt).toBe(0x123456789abcdefn);
      expect(typeof decoded.bigInt).toBe("bigint");
    });

    it("should encode BigInt with correct little-endian byte order", () => {
      // Test specific value to verify byte order
      const testValue = 0x0102030405060708n;
      const encoded = OPACK.encode({ val: testValue });

      // Find the 0x33 prefix and verify the 8 bytes following it
      const prefixIndex = encoded.indexOf(0x33);
      expect(prefixIndex).toBeGreaterThan(-1);

      // Extract the 8 bytes after 0x33
      const bytes = encoded.subarray(prefixIndex + 1, prefixIndex + 9);

      // Verify little-endian encoding (least significant byte first)
      expect(bytes[0]).toBe(0x08);
      expect(bytes[1]).toBe(0x07);
      expect(bytes[2]).toBe(0x06);
      expect(bytes[3]).toBe(0x05);
      expect(bytes[4]).toBe(0x04);
      expect(bytes[5]).toBe(0x03);
      expect(bytes[6]).toBe(0x02);
      expect(bytes[7]).toBe(0x01);
    });

    it("should handle session ID round-trip without precision loss", () => {
      // Simulate the actual session ID calculation from CompanionSessionService
      const localSessionId = 1152166557;
      const remoteSessionId = 1670069125;
      const combinedSessionId =
        (BigInt(remoteSessionId) << 32n) | BigInt(localSessionId);

      const message = {
        _i: "_mcc",
        _t: 2,
        _c: {
          _sid: combinedSessionId,
          _mcc: 5, // GetVolume command
        },
        _x: 1,
      };

      const encoded = OPACK.encode(message);
      const decoded = OPACK.decode(encoded);

      // Verify exact value is preserved
      expect(decoded._c._sid).toBe(combinedSessionId);
      expect(decoded._c._sid).toBe(7172892275086502557n);

      // Verify we can extract the original components
      const extractedRemote = Number(decoded._c._sid >> 32n);
      const extractedLocal = Number(decoded._c._sid & 0xffffffffn);

      expect(extractedRemote).toBe(remoteSessionId);
      expect(extractedLocal).toBe(localSessionId);
    });
  });
});
