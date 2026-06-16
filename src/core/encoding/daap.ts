/**
 * DAAP / DMAP encoding.
 *
 * Apple's audio protocols carry now-playing metadata as DMAP (Digital Media Access
 * Protocol) content codes — the same tag/length/value framing used by DAAP. Each tag
 * is a 4-character ASCII code followed by a big-endian 32-bit length and the value.
 * Container tags (`mlit`, `mlcl`, …) nest further tags.
 *
 * This module exposes the raw codec plus thin metadata helpers. It does not hide the
 * tag structure — `decode`/`decodeToObject` give direct access to every tag on the
 * wire, while `encodeTrackMetadata`/`decodeTrackMetadata` are conveniences over the
 * common now-playing fields.
 *
 * Ported and adapted from basmilius/apple-protocols (encoding/daap.ts).
 */

/**
 * Maps four-character DAAP tag codes to their human-readable DMAP/DAAP content code
 * names. Useful for identifying the semantic meaning of tags in a decoded message.
 */
export const ContentCode = {
  // Container tags
  mlit: "dmap.listingitem",
  mlcl: "dmap.listing",
  msrv: "dmap.serverinforesponse",
  mcon: "dmap.container",

  // Item metadata
  miid: "dmap.itemid",
  minm: "dmap.itemname",
  mikd: "dmap.itemkind",
  mper: "dmap.persistentid",

  // Song metadata
  asal: "daap.songalbum",
  asar: "daap.songartist",
  asaa: "daap.songalbumartist",
  ascp: "daap.songcomposer",
  asgn: "daap.songgenre",
  astm: "daap.songtime",
  astn: "daap.songtracknumber",
  asdc: "daap.songdisccount",
  asdn: "daap.songdiscnumber",
  astc: "daap.songtrackcount",
  asyr: "daap.songyear",
  asbr: "daap.songbitrate",
  assr: "daap.songsamplerate",
  assz: "daap.songsize",

  // Playback status
  caps: "daap.songplaystatus",
  cash: "daap.songshufflestate",
  carp: "daap.songrepeatstate",
  cavs: "daap.songvisiblestate",

  // Album art
  aePP: "com.apple.itunes.photo-properties",
} as const;

/**
 * DMAP value type identifiers, keyed by tag.
 *
 * Type values: 1=byte, 2=unsigned byte, 3=short, 4=unsigned short, 5=int,
 * 6=unsigned int, 7=long, 8=unsigned long, 9=string, 10=date, 11=version,
 * 12=container. Used by the decoder to interpret each tag's raw bytes.
 */
export const TagType = {
  mlit: 12, // container
  mlcl: 12, // container
  mcon: 12, // container
  msrv: 12, // container

  miid: 5, // int
  minm: 9, // string
  mikd: 1, // byte
  mper: 7, // long

  asal: 9, // string
  asar: 9, // string
  asaa: 9, // string
  ascp: 9, // string
  asgn: 9, // string
  astm: 5, // int (milliseconds)
  astn: 3, // short
  asdc: 3, // short
  asdn: 3, // short
  astc: 3, // short
  asyr: 3, // short
  asbr: 3, // short
  assr: 5, // int
  assz: 5, // int

  caps: 1, // byte (play status)
  cash: 1, // byte (shuffle state)
  carp: 1, // byte (repeat state)
  cavs: 1, // byte (visible state)

  aePP: 9, // string
} as const;

/** Union of all valid four-character DAAP content-code keys. */
export type ContentCodeKey = keyof typeof ContentCode;

/** A single decoded DAAP tag with its raw value bytes. */
export interface DecodedTag {
  /** The four-character ASCII tag code. */
  readonly tag: string;
  /** The byte length of the value. */
  readonly length: number;
  /** The raw, undecoded value bytes. */
  readonly value: Buffer;
}

/** Playback state of a DAAP media player. */
export interface PlaybackStatus {
  /** Whether the player is currently playing. */
  readonly playing?: boolean;
  /** Whether shuffle mode is enabled. */
  readonly shuffle?: boolean;
  /** Repeat mode: off, one track, or all. */
  readonly repeat?: "off" | "one" | "all";
}

/** Metadata for a single media track. Durations are in seconds. */
export interface TrackMetadata {
  /** Track title (`minm`). */
  readonly title?: string;
  /** Track artist (`asar`). */
  readonly artist?: string;
  /** Album artist (`asaa`). */
  readonly albumArtist?: string;
  /** Album name (`asal`). */
  readonly album?: string;
  /** Composer (`ascp`). */
  readonly composer?: string;
  /** Genre (`asgn`). */
  readonly genre?: string;
  /** Duration in seconds (`astm`, stored on the wire as milliseconds). */
  readonly duration?: number;
  /** Track number within the album (`astn`). */
  readonly trackNumber?: number;
  /** Total tracks on the album (`astc`). */
  readonly trackCount?: number;
  /** Disc number within the set (`asdn`). */
  readonly discNumber?: number;
  /** Total discs in the set (`asdc`). */
  readonly discCount?: number;
  /** Release year (`asyr`). */
  readonly year?: number;
  /** Bitrate in kbps (`asbr`). */
  readonly bitrate?: number;
  /** Sample rate in Hz (`assr`). */
  readonly sampleRate?: number;
  /** File size in bytes (`assz`). */
  readonly size?: number;
}

function assertTag(tag: string): void {
  if (tag.length !== 4) {
    throw new Error(
      `Invalid DAAP tag: ${tag}. Tags must be exactly 4 characters.`
    );
  }
}

/**
 * DAAP / DMAP encoder and decoder.
 *
 * @example
 * ```ts
 * const buf = DAAP.encodeTrackMetadata({ title: "Song", artist: "Artist", duration: 210 });
 * const meta = DAAP.decodeTrackMetadata(buf);
 * ```
 */
export class DAAP {
  /**
   * Encodes a single DAAP tag with an automatically sized value.
   *
   * Numbers use the smallest big-endian representation that fits; bigints use 8
   * bytes; strings are UTF-8; buffers are written verbatim.
   *
   * @param tag - Four-character ASCII tag code.
   * @param value - The value to encode.
   * @returns A buffer containing the tag, length, and value.
   * @throws {Error} If the tag is not exactly 4 characters.
   */
  static encodeTag(
    tag: string,
    value: Buffer | string | number | bigint
  ): Buffer {
    assertTag(tag);

    const tagBuffer = Buffer.from(tag, "ascii");
    let valueBuffer: Buffer;

    if (typeof value === "string") {
      valueBuffer = Buffer.from(value, "utf8");
    } else if (typeof value === "bigint") {
      valueBuffer = Buffer.alloc(8);
      valueBuffer.writeBigUInt64BE(value, 0);
    } else if (typeof value === "number") {
      if (value <= 0xff && value >= 0) {
        valueBuffer = Buffer.alloc(1);
        valueBuffer.writeUInt8(value, 0);
      } else if (value <= 0xffff && value >= 0) {
        valueBuffer = Buffer.alloc(2);
        valueBuffer.writeUInt16BE(value, 0);
      } else if (value <= 0xffffffff && value >= 0) {
        valueBuffer = Buffer.alloc(4);
        valueBuffer.writeUInt32BE(value, 0);
      } else {
        valueBuffer = Buffer.alloc(8);
        valueBuffer.writeBigInt64BE(BigInt(value), 0);
      }
    } else {
      valueBuffer = value;
    }

    const lengthBuffer = Buffer.allocUnsafe(4);
    lengthBuffer.writeUInt32BE(valueBuffer.length, 0);

    return Buffer.concat([tagBuffer, lengthBuffer, valueBuffer]);
  }

  /**
   * Encodes a DAAP tag with an explicit numeric byte size.
   *
   * Useful when the protocol requires a fixed width regardless of magnitude.
   *
   * @param tag - Four-character ASCII tag code.
   * @param value - The numeric value to encode.
   * @param byteSize - The exact value width: 1, 2, 4, or 8 bytes.
   * @returns A buffer containing the tag, length, and fixed-size value.
   * @throws {Error} If the tag is not exactly 4 characters.
   */
  static encodeTagWithSize(
    tag: string,
    value: number,
    byteSize: 1 | 2 | 4 | 8
  ): Buffer {
    assertTag(tag);

    const tagBuffer = Buffer.from(tag, "ascii");
    const valueBuffer = Buffer.alloc(byteSize);

    switch (byteSize) {
      case 1:
        valueBuffer.writeUInt8(value, 0);
        break;
      case 2:
        valueBuffer.writeUInt16BE(value, 0);
        break;
      case 4:
        valueBuffer.writeUInt32BE(value, 0);
        break;
      case 8:
        valueBuffer.writeBigUInt64BE(BigInt(value), 0);
        break;
    }

    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(byteSize, 0);

    return Buffer.concat([tagBuffer, lengthBuffer, valueBuffer]);
  }

  /**
   * Encodes a container tag wrapping pre-encoded child tags.
   *
   * @param tag - Four-character ASCII container tag code.
   * @param content - Pre-encoded child tags.
   * @returns A buffer containing the container tag, length, and nested content.
   * @throws {Error} If the tag is not exactly 4 characters.
   */
  static encodeContainer(tag: string, content: Buffer): Buffer {
    assertTag(tag);

    const tagBuffer = Buffer.from(tag, "ascii");
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(content.length, 0);

    return Buffer.concat([tagBuffer, lengthBuffer, content]);
  }

  /**
   * Encodes playback status fields (playing/shuffle/repeat) into DAAP tags.
   * Only fields that are defined are emitted.
   *
   * @param status - The playback status to encode.
   * @returns A buffer containing the encoded status tags (no enclosing container).
   */
  static encodePlaybackStatus(status: PlaybackStatus): Buffer {
    const tags: Buffer[] = [];

    if (status.playing !== undefined) {
      tags.push(DAAP.encodeTagWithSize("caps", status.playing ? 4 : 3, 1));
    }

    if (status.shuffle !== undefined) {
      tags.push(DAAP.encodeTagWithSize("cash", status.shuffle ? 1 : 0, 1));
    }

    if (status.repeat !== undefined) {
      let repeatValue = 0;
      if (status.repeat === "one") repeatValue = 1;
      else if (status.repeat === "all") repeatValue = 2;
      tags.push(DAAP.encodeTagWithSize("carp", repeatValue, 1));
    }

    return Buffer.concat(tags);
  }

  /**
   * Encodes track metadata into an `mlit` listing-item container. Only defined
   * fields are emitted. Duration (seconds) is written as the millisecond `astm` tag.
   *
   * @param metadata - The track metadata to encode.
   * @returns A buffer containing an `mlit` container with the metadata tags.
   */
  static encodeTrackMetadata(metadata: TrackMetadata): Buffer {
    const tags: Buffer[] = [];

    if (metadata.title !== undefined)
      tags.push(DAAP.encodeTag("minm", metadata.title));
    if (metadata.artist !== undefined)
      tags.push(DAAP.encodeTag("asar", metadata.artist));
    if (metadata.albumArtist !== undefined)
      tags.push(DAAP.encodeTag("asaa", metadata.albumArtist));
    if (metadata.album !== undefined)
      tags.push(DAAP.encodeTag("asal", metadata.album));
    if (metadata.composer !== undefined)
      tags.push(DAAP.encodeTag("ascp", metadata.composer));
    if (metadata.genre !== undefined)
      tags.push(DAAP.encodeTag("asgn", metadata.genre));
    if (metadata.duration !== undefined)
      tags.push(
        DAAP.encodeTagWithSize("astm", Math.floor(metadata.duration * 1000), 4)
      );
    if (metadata.trackNumber !== undefined)
      tags.push(DAAP.encodeTagWithSize("astn", metadata.trackNumber, 2));
    if (metadata.trackCount !== undefined)
      tags.push(DAAP.encodeTagWithSize("astc", metadata.trackCount, 2));
    if (metadata.discNumber !== undefined)
      tags.push(DAAP.encodeTagWithSize("asdn", metadata.discNumber, 2));
    if (metadata.discCount !== undefined)
      tags.push(DAAP.encodeTagWithSize("asdc", metadata.discCount, 2));
    if (metadata.year !== undefined)
      tags.push(DAAP.encodeTagWithSize("asyr", metadata.year, 2));
    if (metadata.bitrate !== undefined)
      tags.push(DAAP.encodeTagWithSize("asbr", metadata.bitrate, 2));
    if (metadata.sampleRate !== undefined)
      tags.push(DAAP.encodeTagWithSize("assr", metadata.sampleRate, 4));
    if (metadata.size !== undefined)
      tags.push(DAAP.encodeTagWithSize("assz", metadata.size, 4));

    return DAAP.encodeContainer("mlit", Buffer.concat(tags));
  }

  /**
   * Decodes a single DAAP tag from the start of a buffer.
   *
   * @param buffer - The buffer to decode from (needs at least 8 header bytes).
   * @returns A tuple of the decoded tag and the remaining buffer, or `null` if the
   *   buffer is too short to contain a complete tag.
   */
  static decodeTag(buffer: Buffer): [DecodedTag, Buffer] | null {
    if (buffer.length < 8) {
      return null;
    }

    const tag = buffer.subarray(0, 4).toString("ascii");
    const length = buffer.readUInt32BE(4);

    if (buffer.length < 8 + length) {
      return null;
    }

    const value = buffer.subarray(8, 8 + length);
    const remaining = buffer.subarray(8 + length);

    return [{ tag, length, value }, remaining];
  }

  /**
   * Decodes all DAAP tags from a buffer sequentially. Stops when the buffer is
   * exhausted or a tag cannot be fully decoded.
   *
   * @param buffer - The raw DAAP-encoded buffer.
   * @returns The decoded tags in order.
   */
  static decode(buffer: Buffer): DecodedTag[] {
    const tags: DecodedTag[] = [];
    let remaining = buffer;

    while (remaining.length > 0) {
      const result = DAAP.decodeTag(remaining);
      if (!result) break;

      const [tag, rest] = result;
      tags.push(tag);
      remaining = rest;
    }

    return tags;
  }

  /**
   * Decodes a DAAP buffer into a plain object, interpreting values via {@link TagType}.
   * Containers are recursively decoded; tags with an unknown type are kept as raw
   * buffers.
   *
   * @param buffer - The raw DAAP-encoded buffer.
   * @returns An object mapping tag codes to decoded values.
   */
  static decodeToObject(buffer: Buffer): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const tags = DAAP.decode(buffer);

    for (const { tag, value } of tags) {
      const tagType = TagType[tag as keyof typeof TagType] as
        | number
        | undefined;

      if (tagType === undefined) {
        result[tag] = value;
      } else if (tagType === 12) {
        result[tag] = DAAP.decodeToObject(value);
      } else if (tagType === 9) {
        result[tag] = value.toString("utf8");
      } else if (tagType === 1 || tagType === 2) {
        result[tag] = value.readUInt8(0);
      } else if (tagType === 3 || tagType === 4) {
        result[tag] = value.readUInt16BE(0);
      } else if (tagType === 5 || tagType === 6) {
        result[tag] = value.readUInt32BE(0);
      } else if (tagType === 7 || tagType === 8) {
        result[tag] = value.readBigUInt64BE(0);
      } else {
        result[tag] = value;
      }
    }

    return result;
  }

  /**
   * Decodes a DAAP buffer into a structured {@link TrackMetadata} object. Handles
   * both bare tag lists and `mlit`-wrapped containers. Duration is converted from
   * the millisecond `astm` value back to seconds.
   *
   * @param buffer - The raw DAAP-encoded buffer containing track metadata.
   * @returns The decoded track metadata.
   */
  static decodeTrackMetadata(buffer: Buffer): TrackMetadata {
    const obj = DAAP.decodeToObject(buffer);
    const mlit = (obj.mlit as Record<string, unknown>) ?? obj;

    return {
      title: mlit.minm as string | undefined,
      artist: mlit.asar as string | undefined,
      albumArtist: mlit.asaa as string | undefined,
      album: mlit.asal as string | undefined,
      composer: mlit.ascp as string | undefined,
      genre: mlit.asgn as string | undefined,
      duration:
        mlit.astm !== undefined ? (mlit.astm as number) / 1000 : undefined,
      trackNumber: mlit.astn as number | undefined,
      trackCount: mlit.astc as number | undefined,
      discNumber: mlit.asdn as number | undefined,
      discCount: mlit.asdc as number | undefined,
      year: mlit.asyr as number | undefined,
      bitrate: mlit.asbr as number | undefined,
      sampleRate: mlit.assr as number | undefined,
      size: mlit.assz as number | undefined,
    };
  }
}
