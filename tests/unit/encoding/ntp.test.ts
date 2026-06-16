/**
 * Tests for NTP 64-bit timestamp conversions and timing-packet framing.
 */

import { describe, expect, it } from "bun:test";
import {
  NTP,
  NTP_UNIX_EPOCH_OFFSET,
  type NtpPacketFields,
} from "@/core/encoding/ntp.ts";

describe("NTP", () => {
  describe("epoch constant", () => {
    it("matches the well-known 1900→1970 offset of 2,208,988,800 seconds", () => {
      expect(NTP_UNIX_EPOCH_OFFSET).toBe(2208988800n);
      expect(NTP_UNIX_EPOCH_OFFSET).toBe(0x83aa7e80n);
    });
  });

  describe("fromUnixMillis / parts", () => {
    it("places whole seconds in the upper 32 bits, offset by the NTP epoch", () => {
      const ntp = NTP.fromUnixMillis(1000);
      const [seconds, fraction] = NTP.parts(ntp);

      expect(seconds).toBe(Number(NTP_UNIX_EPOCH_OFFSET) + 1);
      expect(fraction).toBe(0);
    });

    it("encodes a half-second as 0x80000000 in the fractional part", () => {
      const ntp = NTP.fromUnixMillis(500);
      const [seconds, fraction] = NTP.parts(ntp);

      expect(seconds).toBe(Number(NTP_UNIX_EPOCH_OFFSET));
      expect(fraction).toBe(0x80000000);
    });

    it("encodes a quarter-second as 0x40000000", () => {
      const [, fraction] = NTP.parts(NTP.fromUnixMillis(250));
      expect(fraction).toBe(0x40000000);
    });
  });

  describe("round-trip", () => {
    it("recovers the original millisecond value", () => {
      for (const ms of [0, 1, 999, 1000, 1500, 1_700_000_000_000]) {
        expect(NTP.toUnixMillis(NTP.fromUnixMillis(ms))).toBe(ms);
      }
    });

    it("parts/combine are inverses", () => {
      const ntp = NTP.fromUnixMillis(1_700_000_000_123);
      const [seconds, fraction] = NTP.parts(ntp);
      expect(NTP.combine(seconds, fraction)).toBe(ntp);
    });
  });

  describe("now", () => {
    it("is anchored to wall-clock time (decades past the NTP epoch)", () => {
      const before = Date.now();
      const [seconds] = NTP.parts(NTP.now());
      const after = Date.now();

      const lower = Math.floor(before / 1000) + Number(NTP_UNIX_EPOCH_OFFSET);
      const upper = Math.ceil(after / 1000) + Number(NTP_UNIX_EPOCH_OFFSET);

      expect(seconds).toBeGreaterThanOrEqual(lower);
      expect(seconds).toBeLessThanOrEqual(upper);
    });
  });

  describe("encode / decode", () => {
    const fields: NtpPacketFields = {
      proto: 0x80,
      type: 0xd4,
      seqno: 0x0007,
      padding: 0,
      reftimeSec: 0x83aa7e81,
      reftimeFrac: 0x40000000,
      recvtimeSec: 0x83aa7e82,
      recvtimeFrac: 0x80000000,
      sendtimeSec: 0x83aa7e83,
      sendtimeFrac: 0xc0000000,
    };

    it("produces a 32-byte big-endian packet", () => {
      const buf = NTP.encode(fields);
      expect(buf.length).toBe(32);
      expect(buf.readUInt8(0)).toBe(0x80);
      expect(buf.readUInt8(1)).toBe(0xd4);
      expect(buf.readUInt16BE(2)).toBe(0x0007);
      expect(buf.readUInt32BE(8)).toBe(0x83aa7e81);
    });

    it("round-trips through decode", () => {
      expect(NTP.decode(NTP.encode(fields))).toEqual(fields);
    });

    it("defaults the send timestamp to zero for short (24-byte) packets", () => {
      const short = NTP.encode(fields).subarray(0, 24);
      const decoded = NTP.decode(short);
      expect(decoded.sendtimeSec).toBe(0);
      expect(decoded.sendtimeFrac).toBe(0);
      expect(decoded.recvtimeFrac).toBe(0x80000000);
    });

    it("throws on buffers smaller than 24 bytes", () => {
      expect(() => NTP.decode(Buffer.alloc(23))).toThrow(RangeError);
    });
  });
});
