import { describe, expect, it } from "bun:test";
import { NSArchive } from "@/core/encoding/ns-archive.ts";

// Helper to convert hex string to ArrayBuffer
function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

// Pre-encoded test fixtures generated with Python's plistlib.
//
// All archives were produced with:
//   plistlib.dumps(archive, fmt=plistlib.FMT_BINARY)
// where `archive` is a dict following the NSKeyedArchiver schema.

/**
 * NSDictionary archive:  { name: "Hello World", value: 42 }
 */
const DICT_ARCHIVE_HEX =
  "62706c6973743030d40102030405061d205924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a70708131415161755246e756c6cd3090a0b0c0d105624636c617373574e532e6b6579735a4e532e6f626a656374738006a20e0f80028003a2111280048005546e616d655576616c75655b48656c6c6f20576f726c64102ad218191a1b5824636c61737365735a24636c6173736e616d65a21b1c5c4e5344696374696f6e617279584e534f626a656374d11e1f54726f6f74800112000186a008111b242932444c525960687375787a7c7f8183888e9a9ca1aab5b8c5ced1d6d800000000000001010000000000000021000000000000000000000000000000dd";

/**
 * NSArray archive:  ["apple", "banana", "cherry"]
 */
const ARRAY_ARCHIVE_HEX =
  "62706c6973743030d4010203040506191c5924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a607081011121355246e756c6cd2090a0b0c5624636c6173735a4e532e6f626a656374738005a30d0e0f800280038004556170706c655662616e616e6156636865727279d2141516175824636c61737365735a24636c6173736e616d65a21718574e534172726179584e534f626a656374d11a1b54726f6f74800112000186a008111b242932444b51565d686a6e7072747a81888d96a1a4acb5b8bdbf0000000000000101000000000000001d000000000000000000000000000000c4";

/**
 * Plain binary plist (not an NSKeyedArchiver):  { key: "value", number: 123 }
 */
const PLAIN_PLIST_HEX =
  "62706c6973743030d201020304536b6579566e756d6265725576616c7565107b080d11181e0000000000000101000000000000000500000000000000000000000000000020";

/**
 * NSData archive wrapping the bytes [0x01, 0x02, 0x03, 0x04]
 */
const NSDATA_ARCHIVE_HEX =
  "62706c6973743030d401020304050613165924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a307080d55246e756c6cd2090a0b0c5624636c617373574e532e6461746180024401020304d20e0f10115824636c61737365735a24636c6173736e616d65a21112564e5344617461584e534f626a656374d1141554726f6f74800112000186a008111b24293244484e535a6264696e7782858c95989d9f00000000000001010000000000000017000000000000000000000000000000a4";

/**
 * Nested NSDictionary archive:  { outerKey: { innerKey: "innerValue" } }
 */
const NESTED_DICT_ARCHIVE_HEX =
  "62706c6973743030d401020304050620235924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a70708111718191a55246e756c6cd3090a0b0c0d0f5624636c617373574e532e6b6579735a4e532e6f626a656374738006a10e8004a1108002d3090a0b1213158006a1148003a116800558696e6e65724b6579586f757465724b65795a696e6e657256616c7565d21b1c1d1e5824636c61737365735a24636c6173736e616d65a21e1f5c4e5344696374696f6e617279584e534f626a656374d1212254726f6f74800112000186a008111b242932444c52596068737577797b7d8486888a8c8e97a0abb0b9c4c7d4dde0e5e700000000000001010000000000000024000000000000000000000000000000ec";

/**
 * Private-subclass archive: object with $classname "__NSSingleObjectArrayI"
 * but $classes = ["__NSSingleObjectArrayI", "NSArray", "NSObject"].
 * Should be decoded as a JS array with a single element.
 */
const PRIVATE_SUBCLASS_ARCHIVE_HEX =
  "62706c6973743030d401020304050616195924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a407080e0f55246e756c6cd2090a0b0c5624636c6173735a4e532e6f626a656374738003a10d8002596f6e6c792d6974656dd2101112135824636c61737365735a24636c6173736e616d65a31314155f10165f5f4e5353696e676c654f626a656374417272617949574e534172726179584e534f626a656374d1171854726f6f74800112000186a008111b24293244494f545b66686a6c767b848f93acb4bdc0c5c70000000000000101000000000000001a000000000000000000000000000000cc";

/**
 * Nested archive: NSDictionary with a "payload" key whose value is NSData
 * containing another NSKeyedArchiver archive (an NSString "nested-string").
 * NSArchive should recursively decode the inner archive.
 */
const NESTED_ARCHIVE_HEX =
  "62706c6973743030d40102030405061f225924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a607081117181c55246e756c6cd3090a0b0c0d0f5624636c617373574e532e6b6579735a4e532e6f626a656374738002a10e8003a1108004d2121314155824636c61737365735a24636c6173736e616d65a215165c4e5344696374696f6e617279584e534f626a656374577061796c6f6164d209191a1b574e532e6461746180054f10e862706c6973743030d401020304050613165924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a307080d55246e756c6cd2090a0b0c5624636c617373594e532e737472696e6780025d6e65737465642d737472696e67d20e0f10115824636c61737365735a24636c6173736e616d65a21112584e53537472696e67584e534f626a656374d1141554726f6f74800112000186a008111b24293244484e535a64667479828d9099a2a5aaac00000000000001010000000000000017000000000000000000000000000000b1d212131d1ea21e16564e5344617461d1202154726f6f74800112000186a000080011001b0024002900320044004b00510058005f00670072007400760078007a007c0081008a0095009800a500ae00b600bb00c300c501b001b501b801bf01c201c701c900000000000002010000000000000023000000000000000000000000000001ce";

describe("NSArchive", () => {
  describe("decode", () => {
    it("dearchives an NSDictionary NSKeyedArchiver archive", () => {
      const result = NSArchive.decode(hexToBuffer(DICT_ARCHIVE_HEX));

      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(false);

      const dict = result as Record<string, unknown>;
      expect(dict["name"]).toBe("Hello World");
      expect(dict["value"]).toBe(42);
    });

    it("dearchives an NSArray NSKeyedArchiver archive", () => {
      const result = NSArchive.decode(hexToBuffer(ARRAY_ARCHIVE_HEX));

      expect(Array.isArray(result)).toBe(true);
      const arr = result as unknown[];
      expect(arr).toHaveLength(3);
      expect(arr[0]).toBe("apple");
      expect(arr[1]).toBe("banana");
      expect(arr[2]).toBe("cherry");
    });

    it("passes a plain binary plist through unchanged", () => {
      const result = NSArchive.decode(hexToBuffer(PLAIN_PLIST_HEX));

      // Should be a plain dict, not dearchived
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
      const dict = result as Record<string, unknown>;
      expect(dict["key"]).toBe("value");
      expect(dict["number"]).toBe(123);
    });

    it("dearchives NSData as an ArrayBuffer", () => {
      const result = NSArchive.decode(hexToBuffer(NSDATA_ARCHIVE_HEX));

      expect(result).toBeInstanceOf(ArrayBuffer);
      const bytes = new Uint8Array(result as ArrayBuffer);
      expect(bytes).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    });

    it("dearchives a nested NSDictionary archive", () => {
      const result = NSArchive.decode(hexToBuffer(NESTED_DICT_ARCHIVE_HEX));

      expect(typeof result).toBe("object");
      const outer = result as Record<string, unknown>;
      expect(outer["outerKey"]).toBeDefined();

      const inner = outer["outerKey"] as Record<string, unknown>;
      expect(typeof inner).toBe("object");
      expect(inner["innerKey"]).toBe("innerValue");
    });

    it("decodes private Apple subclasses via $classes hierarchy", () => {
      // $classname is "__NSSingleObjectArrayI" but $classes contains "NSArray"
      // so it should still be decoded as a JS array.
      const result = NSArchive.decode(hexToBuffer(PRIVATE_SUBCLASS_ARCHIVE_HEX));

      expect(Array.isArray(result)).toBe(true);
      const arr = result as unknown[];
      expect(arr).toHaveLength(1);
      expect(arr[0]).toBe("only-item");
    });

    it("recursively decodes a nested NSKeyedArchiver inside NSData", () => {
      // The outer archive has { payload: <NSData containing another archive> }.
      // The inner archive is an NSString "nested-string".
      // NSArchive should recursively decode the bytes and return the string.
      const result = NSArchive.decode(hexToBuffer(NESTED_ARCHIVE_HEX));

      expect(typeof result).toBe("object");
      const dict = result as Record<string, unknown>;
      expect(dict["payload"]).toBe("nested-string");
    });

    it("throws for an empty buffer", () => {
      // Plist.decode throws on empty buffer; NSArchive.decode propagates that
      expect(() => NSArchive.decode(new ArrayBuffer(0))).toThrow();
    });
  });

  describe("dearchive", () => {
    it("returns non-archive plist values unchanged", () => {
      expect(NSArchive.dearchive("hello")).toBe("hello");
      expect(NSArchive.dearchive(42)).toBe(42);
      expect(NSArchive.dearchive(null)).toBeNull();
      expect(NSArchive.dearchive(true)).toBe(true);
    });

    it("returns a plain plist dict unchanged", () => {
      const plain = { key: "value", count: 5 };
      const result = NSArchive.dearchive(plain);
      expect(result).toEqual(plain);
    });
  });
});
