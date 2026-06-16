/**
 * Unit tests for RAOP utility functions: volume conversion, mDNS TXT
 * record parsing for encryption type, metadata type, and audio format.
 */

import { describe, expect, it } from "bun:test";
import { EncryptionType, MetadataType } from "@/protocols/raop/types.ts";
import {
  parseAudioProperties,
  parseEncryptionTypes,
  parseMetadataTypes,
  pctToDbfs,
} from "@/protocols/raop/utils.ts";

// ─── pctToDbfs ────────────────────────────────────────────────────────────────

describe("pctToDbfs", () => {
  it("returns -144 for 0 (silent)", () => {
    expect(pctToDbfs(0)).toBe(-144);
  });

  it("returns 0 for 100 (full volume)", () => {
    expect(pctToDbfs(100)).toBe(0);
  });

  it("returns -144 for negative values", () => {
    expect(pctToDbfs(-10)).toBe(-144);
  });

  it("returns 0 for values above 100", () => {
    expect(pctToDbfs(110)).toBe(0);
  });

  it("converts 50% to ~-6 dBFS", () => {
    // 20 * log10(0.5) ≈ -6.020
    expect(pctToDbfs(50)).toBeCloseTo(-6.02, 1);
  });

  it("converts 10% to ~-20 dBFS", () => {
    // 20 * log10(0.1) ≈ -20
    expect(pctToDbfs(10)).toBeCloseTo(-20, 1);
  });
});

// ─── parseEncryptionTypes ─────────────────────────────────────────────────────

describe("parseEncryptionTypes", () => {
  it("returns Unknown when `et` is absent", () => {
    expect(parseEncryptionTypes(new Map())).toBe(EncryptionType.Unknown);
  });

  it("sets Unencrypted bit for et=0", () => {
    const props = new Map([["et", "0"]]);
    expect(parseEncryptionTypes(props) & EncryptionType.Unencrypted).not.toBe(
      0
    );
  });

  it("sets MFiSAP bit for et=1", () => {
    const props = new Map([["et", "1"]]);
    expect(parseEncryptionTypes(props) & EncryptionType.MFiSAP).not.toBe(0);
  });

  it("combines bits from a comma-separated list", () => {
    const props = new Map([["et", "0,1"]]);
    const result = parseEncryptionTypes(props);
    expect(result & EncryptionType.Unencrypted).not.toBe(0);
    expect(result & EncryptionType.MFiSAP).not.toBe(0);
  });

  it("ignores unknown encryption type values", () => {
    const props = new Map([["et", "5,99"]]);
    // Should not throw; unknown values contribute Unknown (0) bits only.
    expect(() => parseEncryptionTypes(props)).not.toThrow();
  });
});

// ─── parseMetadataTypes ───────────────────────────────────────────────────────

describe("parseMetadataTypes", () => {
  it("returns NotSupported when `md` is absent", () => {
    expect(parseMetadataTypes(new Map())).toBe(MetadataType.NotSupported);
  });

  it("sets Text bit for md=0", () => {
    const props = new Map([["md", "0"]]);
    expect(parseMetadataTypes(props) & MetadataType.Text).not.toBe(0);
  });

  it("sets Artwork bit for md=1", () => {
    const props = new Map([["md", "1"]]);
    expect(parseMetadataTypes(props) & MetadataType.Artwork).not.toBe(0);
  });

  it("sets Progress bit for md=2", () => {
    const props = new Map([["md", "2"]]);
    expect(parseMetadataTypes(props) & MetadataType.Progress).not.toBe(0);
  });

  it("combines all types from md=0,1,2", () => {
    const props = new Map([["md", "0,1,2"]]);
    const result = parseMetadataTypes(props);
    expect(result & MetadataType.Text).not.toBe(0);
    expect(result & MetadataType.Artwork).not.toBe(0);
    expect(result & MetadataType.Progress).not.toBe(0);
  });
});

// ─── parseAudioProperties ─────────────────────────────────────────────────────

describe("parseAudioProperties", () => {
  it("returns CD-quality defaults when properties are absent", () => {
    const [sr, ch, bpc] = parseAudioProperties(new Map());
    expect(sr).toBe(44100);
    expect(ch).toBe(2);
    expect(bpc).toBe(2);
  });

  it("parses sr, ch, and ss from the TXT record", () => {
    const props = new Map([
      ["sr", "48000"],
      ["ch", "1"],
      ["ss", "24"],
    ]);
    const [sr, ch, bpc] = parseAudioProperties(props);
    expect(sr).toBe(48000);
    expect(ch).toBe(1);
    expect(bpc).toBe(3); // 24 bits / 8
  });

  it("converts ss (bits) to bytesPerChannel correctly", () => {
    const props = new Map([["ss", "16"]]);
    const [, , bpc] = parseAudioProperties(props);
    expect(bpc).toBe(2);
  });
});
