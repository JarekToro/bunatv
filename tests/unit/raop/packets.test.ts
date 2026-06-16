/**
 * Unit tests for RAOP packet helpers: RtpPacket, SyncPacket / retransmit
 * decoder, and PacketFifo.  No device or UDP socket required.
 */

import { describe, expect, it } from "bun:test";
import { PacketFifo } from "@/protocols/raop/packets/PacketFifo.ts";
import { RtpPacket } from "@/protocols/raop/packets/RtpPacket.ts";
import {
  SyncPacket,
  decodeRetransmitRequest,
} from "@/protocols/raop/packets/SyncPacket.ts";

// ─── RtpPacket ────────────────────────────────────────────────────────────────

describe("RtpPacket.encode", () => {
  it("produces a 12-byte buffer", () => {
    const buf = RtpPacket.encode(0x80, 0x60, 1, 0, 0);
    expect(buf.length).toBe(12);
  });

  it("encodes all fields at the correct offsets", () => {
    const buf = RtpPacket.encode(0x80, 0xe0, 0x1234, 0xdeadbeef, 0xcafebabe);

    expect(buf.readUInt8(0)).toBe(0x80);
    expect(buf.readUInt8(1)).toBe(0xe0);
    expect(buf.readUInt16BE(2)).toBe(0x1234);
    expect(buf.readUInt32BE(4)).toBe(0xdeadbeef);
    expect(buf.readUInt32BE(8)).toBe(0xcafebabe);
  });

  it("uses payload type 0xE0 for the first packet and 0x60 for subsequent", () => {
    const first = RtpPacket.encode(0x80, 0xe0, 0, 0, 0);
    const subsequent = RtpPacket.encode(0x80, 0x60, 0, 0, 0);

    expect(first.readUInt8(1)).toBe(0xe0);
    expect(subsequent.readUInt8(1)).toBe(0x60);
  });

  it("wraps 16-bit seqno correctly", () => {
    const buf = RtpPacket.encode(0x80, 0x60, 0xffff, 0, 0);
    expect(buf.readUInt16BE(2)).toBe(0xffff);
  });
});

// ─── SyncPacket ───────────────────────────────────────────────────────────────

describe("SyncPacket.encode", () => {
  it("produces a 20-byte buffer", () => {
    const buf = SyncPacket.encode(0x90, 0xd4, 0x0007, 0, 0, 0, 0);
    expect(buf.length).toBe(20);
  });

  it("encodes all fields at the correct offsets", () => {
    const buf = SyncPacket.encode(
      0x90, // header
      0xd4, // payload type
      0x0007, // seqno
      0x11111111, // rtpTimestamp
      0x22222222, // ntpSec
      0x33333333, // ntpFrac
      0x44444444 // rtpTimestampNow
    );

    expect(buf.readUInt8(0)).toBe(0x90);
    expect(buf.readUInt8(1)).toBe(0xd4);
    expect(buf.readUInt16BE(2)).toBe(0x0007);
    expect(buf.readUInt32BE(4)).toBe(0x11111111);
    expect(buf.readUInt32BE(8)).toBe(0x22222222);
    expect(buf.readUInt32BE(12)).toBe(0x33333333);
    expect(buf.readUInt32BE(16)).toBe(0x44444444);
  });

  it("uses 0x90 header for first sync and 0x80 for subsequent", () => {
    const first = SyncPacket.encode(0x90, 0xd4, 0x0007, 0, 0, 0, 0);
    const subsequent = SyncPacket.encode(0x80, 0xd4, 0x0007, 0, 0, 0, 0);

    expect(first.readUInt8(0)).toBe(0x90);
    expect(subsequent.readUInt8(0)).toBe(0x80);
  });
});

// ─── decodeRetransmitRequest ──────────────────────────────────────────────────

describe("decodeRetransmitRequest", () => {
  it("reads lostSeqno from bytes 4-5 and lostPackets from bytes 6-7", () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16BE(0x1234, 4);
    buf.writeUInt16BE(3, 6);

    const req = decodeRetransmitRequest(buf);
    expect(req.lostSeqno).toBe(0x1234);
    expect(req.lostPackets).toBe(3);
  });

  it("handles zero values", () => {
    const buf = Buffer.alloc(8);
    const req = decodeRetransmitRequest(buf);
    expect(req.lostSeqno).toBe(0);
    expect(req.lostPackets).toBe(0);
  });
});

// ─── PacketFifo ───────────────────────────────────────────────────────────────

describe("PacketFifo", () => {
  it("stores and retrieves packets by seqno", () => {
    const fifo = new PacketFifo(10);
    const pkt = Buffer.from([1, 2, 3]);
    fifo.set(5, pkt);

    expect(fifo.get(5)).toEqual(pkt);
    expect(fifo.has(5)).toBe(true);
  });

  it("returns undefined for missing seqno", () => {
    const fifo = new PacketFifo(10);
    expect(fifo.get(99)).toBeUndefined();
    expect(fifo.has(99)).toBe(false);
  });

  it("evicts the oldest entry when capacity is exceeded", () => {
    const fifo = new PacketFifo(3);
    fifo.set(0, Buffer.from([0]));
    fifo.set(1, Buffer.from([1]));
    fifo.set(2, Buffer.from([2]));
    fifo.set(3, Buffer.from([3])); // evicts seqno 0

    expect(fifo.has(0)).toBe(false);
    expect(fifo.has(1)).toBe(true);
    expect(fifo.has(3)).toBe(true);
    expect(fifo.size).toBe(3);
  });

  it("ignores duplicate seqnos", () => {
    const fifo = new PacketFifo(10);
    fifo.set(1, Buffer.from([1]));
    fifo.set(1, Buffer.from([2])); // ignored

    expect(fifo.get(1)).toEqual(Buffer.from([1]));
  });

  it("clear() empties the fifo", () => {
    const fifo = new PacketFifo(10);
    fifo.set(1, Buffer.from([1]));
    fifo.clear();

    expect(fifo.size).toBe(0);
    expect(fifo.has(1)).toBe(false);
  });
});
