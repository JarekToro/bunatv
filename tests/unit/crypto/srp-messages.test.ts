/**
 * Comprehensive SRP M1-M6 Message Validation Tests
 *
 * Tests for HAP pairing message structure validation based on analysis
 * of pyatv implementation and HAP specification requirements.
 *
 * This fills a critical gap in pyatv testing by providing comprehensive
 * validation of M1-M6 message structure, TLV8 encoding/decoding, and
 * error handling for malformed messages.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  ErrorCode,
  Method,
  State,
  stringify,
  TLV8,
  Tlv8Error,
  TlvBuilder,
  TlvValue,
} from "@/core/encoding/tlv8.ts";

import {
  HAP_FLOW_VECTORS,
  HapMessageUtils,
  M1_MESSAGE_VECTORS,
  M2_MESSAGE_VECTORS,
  M3_MESSAGE_VECTORS,
  M4_MESSAGE_VECTORS,
  M5_MESSAGE_VECTORS,
  M6_MESSAGE_VECTORS,
  TLV8_ERROR_VECTORS,
} from "../../fixtures/hap-message-vectors";
import { HAP_TEST_CONSTANTS } from "../../fixtures/crypto-test-vectors";
import {
  CryptoLoggingUtils,
  PerformanceUtils,
} from "../../helpers/crypto-test-utils";

type AssertedTLV8 = {
  [K in TlvValue]: Buffer;
};

describe("SRP M1-M6 Message Validation Tests", () => {
  beforeEach(() => {
    PerformanceUtils.reset();
    CryptoLoggingUtils.setVerbose(false); // Set to true for debugging
  });

  describe("M1 Message Validation - Initial Pairing Request", () => {
    it("should validate valid M1 pair-setup message structure", () => {
      const { result: messageBuffer, duration } = PerformanceUtils.measureSync(
        "M1_encode",
        () => HapMessageUtils.buildMessage(M1_MESSAGE_VECTORS.validMessage)
      );

      const { result: decoded, duration: decodeDuration } =
        PerformanceUtils.measureSync(
          "M1_decode",
          () => TLV8.decodeObject(messageBuffer) as AssertedTLV8
        );

      // Validate required fields are present
      expect(decoded[TlvValue.Method]).toBeDefined();
      expect(decoded[TlvValue.SeqNo]).toBeDefined();

      // Validate field values
      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M1);

      // Validate using helper function
      expect(
        HapMessageUtils.validateMessage(
          decoded,
          M1_MESSAGE_VECTORS.validMessage.expectedStructure
        )
      ).toBe(true);

      CryptoLoggingUtils.logPerformance("M1 encode", duration);
      CryptoLoggingUtils.logPerformance("M1 decode", decodeDuration);
    });

    it("should validate M1 pair-setup with auth message", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M1_MESSAGE_VECTORS.validWithAuth
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(
        Method.PairSetupWithAuth
      );
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M1);
    });

    it("should validate M1 pair-verify message with public key", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M1_MESSAGE_VECTORS.pairVerifyM1
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairVerify);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M1);
      expect(decoded[TlvValue.PublicKey]).toBeDefined();
      expect(decoded[TlvValue.PublicKey].length).toBe(
        HAP_TEST_CONSTANTS.X25519_PUBLIC_KEY_SIZE
      );
    });

    it("should build M1 message using TlvBuilder", () => {
      const message = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M1)
        .build();

      const decoded = TLV8.decodeObject(message) as AssertedTLV8;
      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M1);
    });

    it("should stringify M1 message correctly", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M1_MESSAGE_VECTORS.validMessage
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;
      const stringified = stringify(decoded);

      expect(stringified).toContain("Method=PairSetup");
      expect(stringified).toContain("SeqNo=M1");
    });

    describe("M1 Error Cases", () => {
      it("should handle M1 message missing Method field", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M1_MESSAGE_VECTORS.invalid.missingMethod
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Method]).toBeUndefined();
        expect(decoded[TlvValue.SeqNo]).toBeDefined();

        // Should fail validation
        expect(
          HapMessageUtils.validateMessage(
            decoded,
            M1_MESSAGE_VECTORS.validMessage.expectedStructure
          )
        ).toBe(false);
      });

      it("should handle M1 message missing SeqNo field", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M1_MESSAGE_VECTORS.invalid.missingSeqNo
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Method]).toBeDefined();
        expect(decoded[TlvValue.SeqNo]).toBeUndefined();

        // Should fail validation
        expect(
          HapMessageUtils.validateMessage(
            decoded,
            M1_MESSAGE_VECTORS.validMessage.expectedStructure
          )
        ).toBe(false);
      });

      it("should handle M1 message with wrong sequence number", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M1_MESSAGE_VECTORS.invalid.wrongSeqNo
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
        expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M2); // Wrong sequence

        // Should fail validation
        expect(
          HapMessageUtils.validateMessage(
            decoded,
            M1_MESSAGE_VECTORS.validMessage.expectedStructure
          )
        ).toBe(false);
      });

      it("should handle M1 message with invalid method value", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M1_MESSAGE_VECTORS.invalid.invalidMethod
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Method].readUInt8(0)).toBe(0xff); // Invalid method
        expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M1);
      });
    });
  });

  describe("M2 Message Validation - Server Challenge Response", () => {
    it("should validate valid M2 pair-setup message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M2_MESSAGE_VECTORS.validPairSetup
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      // Validate required fields
      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M2);
      expect(decoded[TlvValue.Salt]).toBeDefined();
      expect(decoded[TlvValue.PublicKey]).toBeDefined();

      // Validate field sizes
      expect(decoded[TlvValue.Salt].length).toBe(
        HAP_TEST_CONSTANTS.SRP_SALT_SIZE
      );
      expect(decoded[TlvValue.PublicKey].length).toBeGreaterThan(0);

      // Validate using helper function
      expect(
        HapMessageUtils.validateMessage(
          decoded,
          M2_MESSAGE_VECTORS.validPairSetup.expectedStructure
        )
      ).toBe(true);
    });

    it("should validate M2 pair-verify message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M2_MESSAGE_VECTORS.validPairVerify
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairVerify);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M2);
      expect(decoded[TlvValue.PublicKey]).toBeDefined();
      expect(decoded[TlvValue.EncryptedData]).toBeDefined();

      // Validate field sizes
      expect(decoded[TlvValue.PublicKey].length).toBe(
        HAP_TEST_CONSTANTS.X25519_PUBLIC_KEY_SIZE
      );
      expect(decoded[TlvValue.EncryptedData].length).toBeGreaterThan(0);
    });

    it("should validate M2 error response structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M2_MESSAGE_VECTORS.errorResponse
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M2);
      expect(decoded[TlvValue.Error]).toBeDefined();
      expect(decoded[TlvValue.Error].readUInt8(0)).toBe(
        ErrorCode.Authentication
      );
    });

    it("should build M2 message using helper function", () => {
      const message = HapMessageUtils.buildM2PairSetup();
      const decoded = TLV8.decodeObject(message) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M2);
      expect(decoded[TlvValue.Salt]).toBeDefined();
      expect(decoded[TlvValue.PublicKey]).toBeDefined();
    });

    describe("M2 Error Cases", () => {
      it("should handle M2 message missing required fields", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M2_MESSAGE_VECTORS.invalid.missingRequiredFields
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
        expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M2);
        expect(decoded[TlvValue.Salt]).toBeUndefined();
        expect(decoded[TlvValue.PublicKey]).toBeUndefined();
      });

      it("should handle M2 message with invalid salt size", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M2_MESSAGE_VECTORS.invalid.invalidSaltSize
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Salt].length).toBe(2); // Invalid size
        expect(decoded[TlvValue.Salt].length).not.toBe(
          HAP_TEST_CONSTANTS.SRP_SALT_SIZE
        );
      });
    });
  });

  describe("M3 Message Validation - Client Proof", () => {
    it("should validate valid M3 pair-setup message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M3_MESSAGE_VECTORS.validPairSetup
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M3);
      expect(decoded[TlvValue.PublicKey]).toBeDefined();
      expect(decoded[TlvValue.Proof]).toBeDefined();

      // Validate using helper function
      expect(
        HapMessageUtils.validateMessage(
          decoded,
          M3_MESSAGE_VECTORS.validPairSetup.expectedStructure
        )
      ).toBe(true);
    });

    it("should validate M3 pair-verify message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M3_MESSAGE_VECTORS.validPairVerify
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairVerify);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M3);
      expect(decoded[TlvValue.EncryptedData]).toBeDefined();
    });

    it("should build M3 message using helper function", () => {
      const message = HapMessageUtils.buildM3PairSetup();
      const decoded = TLV8.decodeObject(message) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M3);
      expect(decoded[TlvValue.PublicKey]).toBeDefined();
      expect(decoded[TlvValue.Proof]).toBeDefined();
    });

    describe("M3 Error Cases", () => {
      it("should handle M3 message missing proof", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M3_MESSAGE_VECTORS.invalid.missingProof
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Proof]).toBeUndefined();
      });

      it("should handle M3 message with invalid proof size", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M3_MESSAGE_VECTORS.invalid.invalidProofSize
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Proof].length).toBe(2); // Invalid size
      });
    });
  });

  describe("M4 Message Validation - Server Proof", () => {
    it("should validate valid M4 pair-setup message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M4_MESSAGE_VECTORS.validPairSetup
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M4);
      expect(decoded[TlvValue.Proof]).toBeDefined();

      // Validate using helper function
      expect(
        HapMessageUtils.validateMessage(
          decoded,
          M4_MESSAGE_VECTORS.validPairSetup.expectedStructure
        )
      ).toBe(true);
    });

    it("should validate M4 pair-verify message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M4_MESSAGE_VECTORS.validPairVerify
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairVerify);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M4);
      expect(decoded[TlvValue.EncryptedData]).toBeDefined();
    });

    it("should validate M4 error response structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M4_MESSAGE_VECTORS.errorResponse
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Error].readUInt8(0)).toBe(
        ErrorCode.Authentication
      );
    });

    it("should build M4 message using helper function", () => {
      const message = HapMessageUtils.buildM4PairSetup();
      const decoded = TLV8.decodeObject(message) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M4);
      expect(decoded[TlvValue.Proof]).toBeDefined();
    });

    describe("M4 Error Cases", () => {
      it("should handle M4 message missing proof", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M4_MESSAGE_VECTORS.invalid.missingProof
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.Proof]).toBeUndefined();
      });
    });
  });

  describe("M5 Message Validation - Client Encrypted Data", () => {
    it("should validate valid M5 message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M5_MESSAGE_VECTORS.valid
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M5);
      expect(decoded[TlvValue.EncryptedData]).toBeDefined();
      expect(decoded[TlvValue.EncryptedData].length).toBeGreaterThan(0);

      // Validate using helper function
      expect(
        HapMessageUtils.validateMessage(
          decoded,
          M5_MESSAGE_VECTORS.valid.expectedStructure
        )
      ).toBe(true);
    });

    it("should build M5 message using helper function", () => {
      const message = HapMessageUtils.buildM5();
      const decoded = TLV8.decodeObject(message) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M5);
      expect(decoded[TlvValue.EncryptedData]).toBeDefined();
    });

    describe("M5 Error Cases", () => {
      it("should handle M5 message missing encrypted data", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M5_MESSAGE_VECTORS.invalid.missingEncryptedData
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.EncryptedData]).toBeUndefined();
      });

      it("should handle M5 message with empty encrypted data", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M5_MESSAGE_VECTORS.invalid.emptyEncryptedData
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.EncryptedData].length).toBe(0);
      });
    });
  });

  describe("M6 Message Validation - Server Encrypted Response", () => {
    it("should validate valid M6 message structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M6_MESSAGE_VECTORS.valid
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M6);
      expect(decoded[TlvValue.EncryptedData]).toBeDefined();
      expect(decoded[TlvValue.EncryptedData].length).toBeGreaterThan(0);

      // Validate using helper function
      expect(
        HapMessageUtils.validateMessage(
          decoded,
          M6_MESSAGE_VECTORS.valid.expectedStructure
        )
      ).toBe(true);
    });

    it("should validate M6 error response structure", () => {
      const messageBuffer = HapMessageUtils.buildMessage(
        M6_MESSAGE_VECTORS.errorResponse
      );
      const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

      expect(decoded[TlvValue.Error].readUInt8(0)).toBe(
        ErrorCode.Authentication
      );
    });

    it("should build M6 message using helper function", () => {
      const message = HapMessageUtils.buildM6();
      const decoded = TLV8.decodeObject(message) as AssertedTLV8;

      expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup);
      expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(State.M6);
      expect(decoded[TlvValue.EncryptedData]).toBeDefined();
    });

    describe("M6 Error Cases", () => {
      it("should handle M6 message missing encrypted data", () => {
        const messageBuffer = HapMessageUtils.buildMessage(
          M6_MESSAGE_VECTORS.invalid.missingEncryptedData
        );
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        expect(decoded[TlvValue.EncryptedData]).toBeUndefined();
      });
    });
  });

  describe("Complete HAP Flow Validation", () => {
    it("should validate successful pair-setup flow", () => {
      const flow = HAP_FLOW_VECTORS.pairSetupSuccess;

      for (let i = 0; i < flow.length; i++) {
        const messageVector = flow[i];
        const messageBuffer = HapMessageUtils.buildMessage(messageVector!);
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        // Each message should have correct sequence number
        expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(i + 1); // M1=1, M2=2, etc.

        // Each message should be valid according to its expected structure
        expect(
          HapMessageUtils.validateMessage(
            decoded,
            messageVector!.expectedStructure
          )
        ).toBe(true);
      }
    });

    it("should validate successful pair-verify flow", () => {
      const flow = HAP_FLOW_VECTORS.pairVerifySuccess;

      for (let i = 0; i < flow.length; i++) {
        const messageVector = flow[i]!;
        const messageBuffer = HapMessageUtils.buildMessage(messageVector);
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        // Each message should have correct sequence number
        expect(decoded[TlvValue.SeqNo].readUInt8(0)).toBe(i + 1);

        // All pair-verify messages should have Method.PairVerify
        expect(decoded[TlvValue.Method].readUInt8(0)).toBe(Method.PairVerify);
      }
    });

    it("should validate authentication failure flows", () => {
      const failureFlows = [
        HAP_FLOW_VECTORS.authFailureM2,
        HAP_FLOW_VECTORS.authFailureM4,
        HAP_FLOW_VECTORS.authFailureM6,
      ];

      for (const flow of failureFlows) {
        const lastMessage = flow[flow.length - 1]!;
        const messageBuffer = HapMessageUtils.buildMessage(lastMessage);
        const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

        // Last message should contain an error
        expect(decoded[TlvValue.Error]).toBeDefined();
        expect(decoded[TlvValue.Error].readUInt8(0)).toBe(
          ErrorCode.Authentication
        );
      }
    });
  });

  describe("TLV8 Error Handling", () => {
    it("should handle truncated TLV data gracefully", () => {
      const truncatedVectors = TLV8_ERROR_VECTORS.truncated;

      // Type only - should return empty object or handle gracefully
      const result1 = TLV8.tryDecodeObject(truncatedVectors.typeOnly);
      expect(result1.isComplete).toBe(false);
      expect(result1.errors.length).toBeGreaterThan(0);

      // Type and length - should return empty object or handle gracefully
      const result2 = TLV8.tryDecodeObject(truncatedVectors.typeAndLength);
      expect(result2.isComplete).toBe(false);

      // Incomplete value - should return empty object or handle gracefully
      const result3 = TLV8.tryDecodeObject(truncatedVectors.incompleteValue);
      expect(result3.isComplete).toBe(false);
    });

    it("should handle invalid TLV structure", () => {
      const invalidVectors = TLV8_ERROR_VECTORS.invalid;

      // Empty buffer
      const result1 = TLV8.tryDecodeObject(invalidVectors.empty);
      expect(result1.isComplete).toBe(true); // Empty is complete
      expect(Object.keys(result1.data).length).toBe(0);

      // Zero-length value
      const result2 = TLV8.tryDecodeObject(invalidVectors.zeroLength) as {
        data: AssertedTLV8;
        isComplete: boolean;
        bytesProcessed: number;
        errors: string[];
      };
      expect(result2.isComplete).toBe(true);
      expect(result2.data[TlvValue.Method]).toBeDefined();
      expect(result2.data[TlvValue.Method].length).toBe(0);
    });

    it("should handle large value fragmentation correctly", () => {
      const largeValueBuffer = TLV8_ERROR_VECTORS.invalid.largeValue;
      const decoded = TLV8.decodeObject(largeValueBuffer) as AssertedTLV8;

      // Should merge fragmented values
      expect(decoded[TlvValue.PublicKey]).toBeDefined();
      expect(decoded[TlvValue.PublicKey].length).toBe(255 + 129); // Combined fragments
    });

    it("should handle duplicate TLV entries correctly", () => {
      const duplicateVectors = TLV8_ERROR_VECTORS.duplicates;

      // Same type - values should be concatenated (per TLV8 spec)
      const result1 = TLV8.decodeObject(
        duplicateVectors.sameType
      ) as AssertedTLV8;
      expect(result1[TlvValue.Method]).toBeDefined();
      expect(result1[TlvValue.Method].length).toBe(2); // Both values concatenated
      expect(result1[TlvValue.Method].readUInt8(0)).toBe(Method.PairSetup); // First value
      expect(result1[TlvValue.Method].readUInt8(1)).toBe(Method.PairVerify); // Second value

      // Fragmented entry - should be merged
      const result2 = TLV8.decodeObject(
        duplicateVectors.fragmented
      ) as AssertedTLV8;
      expect(result2[TlvValue.Identifier]).toBeDefined();
      expect(result2[TlvValue.Identifier].toString("utf8")).toBe("Hello World");
    });

    it("should throw on malformed TLV encoding attempts", () => {
      expect(() => {
        TLV8.encode(-1, Buffer.from("test")); // Invalid type
      }).toThrow(Tlv8Error);

      expect(() => {
        TLV8.encode(256, Buffer.from("test")); // Invalid type
      }).toThrow(Tlv8Error);
    });
  });

  describe("Performance Benchmarks", () => {
    it("should benchmark M1-M6 message encoding/decoding", async () => {
      const iterations = 100;

      const messages = [
        HapMessageUtils.buildM1(),
        HapMessageUtils.buildM2PairSetup(),
        HapMessageUtils.buildM3PairSetup(),
        HapMessageUtils.buildM4PairSetup(),
        HapMessageUtils.buildM5(),
        HapMessageUtils.buildM6(),
      ];

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i]!;
        const messageName = `M${i + 1}`;

        // Benchmark encoding
        const { avgDuration: encodeTime } = PerformanceUtils.benchmarkSync(
          `${messageName}_encode`,
          () => {
            const decoded = TLV8.decodeObject(message);
            return TLV8.encodeObject(decoded);
          },
          iterations
        );

        // Benchmark decoding
        const { avgDuration: decodeTime } = PerformanceUtils.benchmarkSync(
          `${messageName}_decode`,
          () => TLV8.decodeObject(message),
          iterations
        );

        CryptoLoggingUtils.logBenchmark(
          `${messageName} encode`,
          encodeTime * iterations,
          iterations
        );
        CryptoLoggingUtils.logBenchmark(
          `${messageName} decode`,
          decodeTime * iterations,
          iterations
        );

        // Performance expectations
        expect(encodeTime).toBeLessThan(1); // Should be sub-millisecond
        expect(decodeTime).toBeLessThan(1); // Should be sub-millisecond
      }
    });

    it("should benchmark complete flow processing", () => {
      const iterations = 50;

      const { avgDuration } = PerformanceUtils.benchmarkSync(
        "complete_flow",
        () => {
          const flow = HAP_FLOW_VECTORS.pairSetupSuccess;
          for (const messageVector of flow) {
            const messageBuffer = HapMessageUtils.buildMessage(messageVector);
            const decoded = TLV8.decodeObject(messageBuffer) as AssertedTLV8;

            // Validate message
            HapMessageUtils.validateMessage(
              decoded,
              messageVector.expectedStructure
            );
          }
        },
        iterations
      );

      CryptoLoggingUtils.logBenchmark(
        "Complete M1-M6 flow processing",
        avgDuration * iterations,
        iterations
      );
      expect(avgDuration).toBeLessThan(5); // Should complete flow in under 5ms
    });
  });
});
