/**
 * Integration tests for TLV8 with realistic HAP pairing scenarios
 */

import { describe, expect, it } from "bun:test";
import {
  ErrorCode,
  Method,
  State,
  stringify,
  TLV8,
  TlvBuilder,
  TlvValue,
} from "@/core/encoding/tlv8.ts";

describe("TLV8 HAP Tests", () => {
  describe("HAP Pairing Flow Scenarios", () => {
    it("should handle Pair Setup M1 message", () => {
      // Client initiates pairing with Pair Setup M1
      const m1 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M1)
        .build();

      const decoded = TLV8.decodeObject(m1);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M1]));

      const description = stringify(decoded);
      expect(description).toBe("Method=PairSetup, SeqNo=M1");
    });

    it("should handle Pair Setup M2 response with salt and public key", () => {
      // Server responds with M2 containing salt and server public key
      const salt = Buffer.from("test-salt-16-bytes");
      const publicKey = Buffer.from("server-public-key-32-bytes-long");

      const m2 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M2)
        .salt(salt)
        .publicKey(publicKey)
        .build();

      const decoded = TLV8.decodeObject(m2);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M2]));
      expect(decoded[TlvValue.Salt]).toEqual(salt);
      expect(decoded[TlvValue.PublicKey]).toEqual(publicKey);
    });

    it("should handle Pair Setup M3 with client proof", () => {
      // Client sends M3 with client public key and proof
      const clientPublicKey = Buffer.from("client-public-key-32-bytes-long");
      const clientProof = Buffer.from("client-srp-proof-data");

      const m3 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M3)
        .publicKey(clientPublicKey)
        .proof(clientProof)
        .build();

      const decoded = TLV8.decodeObject(m3);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M3]));
      expect(decoded[TlvValue.PublicKey]).toEqual(clientPublicKey);
      expect(decoded[TlvValue.Proof]).toEqual(clientProof);
    });

    it("should handle Pair Setup M4 with server proof", () => {
      // Server responds with M4 containing server proof
      const serverProof = Buffer.from("server-srp-proof-verification");

      const m4 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M4)
        .proof(serverProof)
        .build();

      const decoded = TLV8.decodeObject(m4);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M4]));
      expect(decoded[TlvValue.Proof]).toEqual(serverProof);
    });

    it("should handle Pair Setup M5 with encrypted exchange", () => {
      // Client sends M5 with encrypted device info
      const encryptedData = Buffer.from("encrypted-device-info-and-ltpk");

      const m5 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M5)
        .encryptedData(encryptedData)
        .build();

      const decoded = TLV8.decodeObject(m5);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M5]));
      expect(decoded[TlvValue.EncryptedData]).toEqual(encryptedData);
    });

    it("should handle Pair Setup M6 completion", () => {
      // Server responds with M6 containing encrypted server info
      const encryptedData = Buffer.from("encrypted-server-ltpk-and-signature");

      const m6 = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M6)
        .encryptedData(encryptedData)
        .build();

      const decoded = TLV8.decodeObject(m6);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M6]));
      expect(decoded[TlvValue.EncryptedData]).toEqual(encryptedData);
    });

    it("should handle Pair Verify M1 message", () => {
      // Client starts pair verify with public key
      const clientPublicKey = Buffer.from("client-curve25519-public-key-32b");

      const m1 = new TlvBuilder()
        .method(Method.PairVerify)
        .seqNo(State.M1)
        .publicKey(clientPublicKey)
        .build();

      const decoded = TLV8.decodeObject(m1);

      expect(decoded[TlvValue.Method]).toEqual(
        Buffer.from([Method.PairVerify])
      );
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M1]));
      expect(decoded[TlvValue.PublicKey]).toEqual(clientPublicKey);

      const description = stringify(decoded);
      expect(description).toContain("Method=PairVerify");
      expect(description).toContain("SeqNo=M1");
      expect(description).toContain("PublicKey=32bytes");
    });

    it("should handle error responses", () => {
      // Server responds with authentication error
      const errorResponse = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M2)
        .error(ErrorCode.Authentication)
        .build();

      const decoded = TLV8.decodeObject(errorResponse);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M2]));
      expect(decoded[TlvValue.Error]).toEqual(
        Buffer.from([ErrorCode.Authentication])
      );

      const description = stringify(decoded);
      expect(description).toBe(
        "Method=PairSetup, SeqNo=M2, Error=Authentication"
      );
    });

    it("should handle backoff responses", () => {
      // Server requests backoff (wait 5 seconds)
      const backoffResponse = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M2)
        .error(ErrorCode.BackOff)
        .add(TlvValue.BackOff, Buffer.from([0x05, 0x00, 0x00, 0x00])) // 5 seconds little-endian
        .build();

      const decoded = TLV8.decodeObject(backoffResponse);

      expect(decoded[TlvValue.Method]).toEqual(Buffer.from([Method.PairSetup]));
      expect(decoded[TlvValue.SeqNo]).toEqual(Buffer.from([State.M2]));
      expect(decoded[TlvValue.Error]).toEqual(Buffer.from([ErrorCode.BackOff]));

      const description = stringify(decoded);
      expect(description).toBe(
        "Method=PairSetup, SeqNo=M2, Error=BackOff, BackOff=5s"
      );
    });
  });

  describe("Large Data Handling", () => {
    it("should handle certificate data (typically > 255 bytes)", () => {
      // Simulate a certificate that's larger than 255 bytes
      const largeCertificate = Buffer.alloc(512, 0xca);

      const certMessage = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M6)
        .add(TlvValue.Certificate, largeCertificate)
        .build();

      const decoded = TLV8.decodeObject(certMessage);

      expect(decoded[TlvValue.Certificate]).toEqual(largeCertificate);
      expect(decoded[TlvValue.Certificate]).toHaveLength(512);
    });

    it("should handle encrypted data fragmentation", () => {
      // Simulate large encrypted payload
      const largeEncryptedData = Buffer.alloc(1024, 0xee);

      const encryptedMessage = new TlvBuilder()
        .method(Method.PairSetup)
        .seqNo(State.M5)
        .encryptedData(largeEncryptedData)
        .build();

      const decoded = TLV8.decodeObject(encryptedMessage);

      expect(decoded[TlvValue.EncryptedData]).toEqual(largeEncryptedData);
      expect(decoded[TlvValue.EncryptedData]).toHaveLength(1024);
    });
  });

  describe("Real-world Data Compatibility", () => {
    it("should match pyatv test data format", () => {
      // Test data from pyatv tests
      const singleKeyIn = { 10: Buffer.from([0x31, 0x32, 0x33]) };
      const singleKeyOut = Buffer.from([0x0a, 0x03, 0x31, 0x32, 0x33]);

      expect(TLV8.encodeObject(singleKeyIn)).toEqual(singleKeyOut);
      expect(TLV8.decodeObject(singleKeyOut)).toEqual(singleKeyIn);
    });

    it("should handle double key data like pyatv", () => {
      // Ordered data like pyatv tests
      const doubleKeyData = {
        1: Buffer.from([0x31, 0x31, 0x31]),
        4: Buffer.from([0x32, 0x32, 0x32]),
      };

      const encoded = TLV8.encodeObject(doubleKeyData);
      const decoded = TLV8.decodeObject(encoded);

      expect(decoded).toEqual(doubleKeyData);
    });

    it("should handle large key fragmentation like pyatv", () => {
      // 256-byte value that gets fragmented
      const largeKeyIn = { 2: Buffer.alloc(256, 0x31) };
      const largeKeyOut = Buffer.concat([
        Buffer.from([0x02, 0xff]),
        Buffer.alloc(255, 0x31),
        Buffer.from([0x02, 0x01, 0x31]),
      ]);

      expect(TLV8.encodeObject(largeKeyIn)).toEqual(largeKeyOut);
      expect(TLV8.decodeObject(largeKeyOut)).toEqual(largeKeyIn);
    });
  });
});
