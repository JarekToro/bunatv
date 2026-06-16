/**
 * Tests for the DAAP / DMAP content-code codec.
 */

import { describe, expect, it } from "bun:test";
import {
  ContentCode,
  DAAP,
  TagType,
  type TrackMetadata,
} from "@/core/encoding/daap.ts";

describe("DAAP", () => {
  describe("encodeTag", () => {
    it("frames a string tag as tag + BE length + UTF-8 value", () => {
      const buf = DAAP.encodeTag("minm", "Hi");
      expect(buf.subarray(0, 4).toString("ascii")).toBe("minm");
      expect(buf.readUInt32BE(4)).toBe(2);
      expect(buf.subarray(8).toString("utf8")).toBe("Hi");
    });

    it("auto-sizes numbers to the smallest big-endian width", () => {
      expect(DAAP.encodeTag("mikd", 5).readUInt32BE(4)).toBe(1); // byte
      expect(DAAP.encodeTag("astn", 300).readUInt32BE(4)).toBe(2); // short
      expect(DAAP.encodeTag("assz", 100000).readUInt32BE(4)).toBe(4); // int
    });

    it("encodes bigint as 8 bytes", () => {
      const buf = DAAP.encodeTag("mper", 0x0102030405060708n);
      expect(buf.readUInt32BE(4)).toBe(8);
      expect(buf.readBigUInt64BE(8)).toBe(0x0102030405060708n);
    });

    it("writes raw buffers verbatim", () => {
      const raw = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const buf = DAAP.encodeTag("aePP", raw);
      expect(buf.subarray(8)).toEqual(raw);
    });

    it("rejects tags that are not exactly four characters", () => {
      expect(() => DAAP.encodeTag("min", "x")).toThrow();
      expect(() => DAAP.encodeTag("minmm", "x")).toThrow();
    });
  });

  describe("encodeTagWithSize", () => {
    it("forces a fixed width regardless of magnitude", () => {
      const buf = DAAP.encodeTagWithSize("astm", 5, 4);
      expect(buf.readUInt32BE(4)).toBe(4);
      expect(buf.readUInt32BE(8)).toBe(5);
    });
  });

  describe("encodeContainer / decode", () => {
    it("wraps children and reads them back", () => {
      const children = Buffer.concat([
        DAAP.encodeTag("minm", "Title"),
        DAAP.encodeTagWithSize("astn", 3, 2),
      ]);
      const container = DAAP.encodeContainer("mlit", children);

      const [tag, rest] = DAAP.decodeTag(container)!;
      expect(tag.tag).toBe("mlit");
      expect(tag.length).toBe(children.length);
      expect(rest.length).toBe(0);

      const decoded = DAAP.decode(tag.value);
      expect(decoded.map((t) => t.tag)).toEqual(["minm", "astn"]);
    });

    it("returns null for a truncated tag", () => {
      expect(DAAP.decodeTag(Buffer.from("minm", "ascii"))).toBeNull();
      const partial = Buffer.concat([
        Buffer.from("minm", "ascii"),
        Buffer.from([0, 0, 0, 10]), // claims 10 bytes, none present
      ]);
      expect(DAAP.decodeTag(partial)).toBeNull();
    });
  });

  describe("decodeToObject", () => {
    it("interprets values by tag type and recurses into containers", () => {
      const buf = DAAP.encodeTrackMetadata({
        title: "Song",
        trackNumber: 7,
        size: 123456,
      });
      const obj = DAAP.decodeToObject(buf);
      const mlit = obj.mlit as Record<string, unknown>;

      expect(typeof mlit.minm).toBe("string");
      expect(mlit.minm).toBe("Song");
      expect(mlit.astn).toBe(7);
      expect(mlit.assz).toBe(123456);
    });

    it("keeps unknown tags as raw buffers", () => {
      const buf = DAAP.encodeTag("zzzz", Buffer.from([1, 2, 3]));
      const obj = DAAP.decodeToObject(buf);
      expect(Buffer.isBuffer(obj.zzzz)).toBe(true);
    });
  });

  describe("track metadata round-trip", () => {
    it("recovers all fields, converting duration via milliseconds", () => {
      const meta: TrackMetadata = {
        title: "Bohemian Rhapsody",
        artist: "Queen",
        albumArtist: "Queen",
        album: "A Night at the Opera",
        composer: "Freddie Mercury",
        genre: "Rock",
        duration: 354,
        trackNumber: 11,
        trackCount: 12,
        discNumber: 1,
        discCount: 1,
        year: 1975,
        bitrate: 320,
        sampleRate: 44100,
        size: 14_000_000,
      };

      const decoded = DAAP.decodeTrackMetadata(DAAP.encodeTrackMetadata(meta));
      expect(decoded).toEqual(meta);
    });

    it("omits undefined fields from the encoding", () => {
      const buf = DAAP.encodeTrackMetadata({ title: "Only Title" });
      const mlit = DAAP.decodeToObject(buf).mlit as Record<string, unknown>;
      expect(Object.keys(mlit)).toEqual(["minm"]);
    });
  });

  describe("playback status", () => {
    it("encodes playing/shuffle/repeat into the documented byte values", () => {
      const buf = DAAP.encodePlaybackStatus({
        playing: true,
        shuffle: true,
        repeat: "all",
      });
      const obj = DAAP.decodeToObject(buf);
      expect(obj.caps).toBe(4); // playing
      expect(obj.cash).toBe(1); // shuffle on
      expect(obj.carp).toBe(2); // repeat all
    });

    it("maps repeat 'one' to 1 and paused to 3", () => {
      const obj = DAAP.decodeToObject(
        DAAP.encodePlaybackStatus({ playing: false, repeat: "one" })
      );
      expect(obj.caps).toBe(3);
      expect(obj.carp).toBe(1);
    });
  });

  describe("content-code tables", () => {
    it("keeps ContentCode and TagType in agreement on container tags", () => {
      for (const tag of ["mlit", "mlcl", "mcon", "msrv"] as const) {
        expect(ContentCode[tag]).toBeDefined();
        expect(TagType[tag]).toBe(12);
      }
    });
  });
});
