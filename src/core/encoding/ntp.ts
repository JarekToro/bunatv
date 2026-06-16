/**
 * NTP (Network Time Protocol) 64-bit timestamps.
 *
 * Apple's audio transports (RTSP/RAOP timing channel, AirPlay) exchange wall-clock
 * timestamps in the NTP format: a 64-bit value where the upper 32 bits are whole
 * seconds since the NTP epoch (1900-01-01) and the lower 32 bits are the binary
 * fraction of a second.
 *
 * This module exposes the raw conversions and the on-the-wire timing-packet layout
 * directly — no scheduling or clock-discipline policy is imposed here. Callers decide
 * how to use the timestamps.
 */

/**
 * Seconds between the NTP epoch (1900-01-01) and the Unix epoch (1970-01-01).
 *
 * Equal to `0x83AA7E80` (2,208,988,800). Used to translate between Unix time
 * (what JavaScript reports) and NTP time (what Apple devices expect).
 */
export const NTP_UNIX_EPOCH_OFFSET = 0x83aa7e80n;

/** A 32-bit fraction of a second spans `2^32` steps. */
const FRACTION_SCALE = 0x100000000n; // 2 ** 32

/** Fields of an NTP timing packet used for clock synchronization with Apple devices. */
export interface NtpPacketFields {
  /** Protocol identifier byte (RTP version + flags). */
  readonly proto: number;
  /** Packet type / payload type byte. */
  readonly type: number;
  /** Sequence number correlating requests and responses. */
  readonly seqno: number;
  /** Padding / reserved word (typically zero). */
  readonly padding: number;
  /** Reference timestamp, whole-seconds part. */
  readonly reftimeSec: number;
  /** Reference timestamp, fractional part. */
  readonly reftimeFrac: number;
  /** Receive timestamp, whole-seconds part. */
  readonly recvtimeSec: number;
  /** Receive timestamp, fractional part. */
  readonly recvtimeFrac: number;
  /** Send timestamp, whole-seconds part. */
  readonly sendtimeSec: number;
  /** Send timestamp, fractional part. */
  readonly sendtimeFrac: number;
}

/**
 * NTP timestamp conversions and timing-packet (de)serialization.
 *
 * @example
 * ```ts
 * const ts = NTP.now();              // current wall-clock as a 64-bit NTP value
 * const [secs, frac] = NTP.parts(ts);
 * const packet = NTP.encode({ proto: 0x80, type: 0xd4, seqno: 0, padding: 0,
 *   reftimeSec: secs, reftimeFrac: frac, recvtimeSec: 0, recvtimeFrac: 0,
 *   sendtimeSec: secs, sendtimeFrac: frac });
 * ```
 */
export class NTP {
  /**
   * Convert Unix time in milliseconds to a 64-bit NTP timestamp.
   *
   * @param unixMillis - Milliseconds since the Unix epoch (e.g. from `Date.now()`).
   * @returns The equivalent 64-bit NTP timestamp.
   */
  static fromUnixMillis(unixMillis: number | bigint): bigint {
    const ms = BigInt(unixMillis);
    const seconds = ms / 1000n;
    const remainderMs = ms - seconds * 1000n;

    return (
      ((seconds + NTP_UNIX_EPOCH_OFFSET) << 32n) |
      ((remainderMs * FRACTION_SCALE) / 1000n)
    );
  }

  /**
   * Convert a 64-bit NTP timestamp back to Unix time in milliseconds.
   *
   * Inverse of {@link NTP.fromUnixMillis}. The fractional part is rounded to the
   * nearest millisecond.
   *
   * @param ntp - A 64-bit NTP timestamp.
   * @returns Milliseconds since the Unix epoch.
   */
  static toUnixMillis(ntp: bigint): number {
    const seconds = (ntp >> 32n) - NTP_UNIX_EPOCH_OFFSET;
    const fraction = ntp & 0xffffffffn;
    // Round to nearest ms: (fraction * 1000 + 2^31) / 2^32
    const remainderMs =
      (fraction * 1000n + FRACTION_SCALE / 2n) / FRACTION_SCALE;

    return Number(seconds * 1000n + remainderMs);
  }

  /**
   * Returns the current wall-clock time as a 64-bit NTP timestamp.
   *
   * Uses `Date.now()` (wall-clock) and never a monotone clock such as
   * `performance.now()` / `process.hrtime`. A monotone clock counts from an
   * arbitrary origin (process start), producing timestamps that are decades off
   * and that jump on every process restart — Apple devices anchor timing to real
   * time, so wall-clock is required for correct synchronization.
   *
   * @returns The current time as a 64-bit NTP timestamp.
   */
  static now(): bigint {
    return NTP.fromUnixMillis(Date.now());
  }

  /**
   * Splits a 64-bit NTP timestamp into its seconds and fractional 32-bit parts.
   *
   * @param ntp - A 64-bit NTP timestamp.
   * @returns A tuple of `[seconds, fraction]` as unsigned 32-bit integers.
   */
  static parts(ntp: bigint): [seconds: number, fraction: number] {
    return [Number(ntp >> 32n), Number(ntp & 0xffffffffn)];
  }

  /**
   * Combines seconds and fractional 32-bit parts into a 64-bit NTP timestamp.
   *
   * Inverse of {@link NTP.parts}.
   *
   * @param seconds - Whole seconds since the NTP epoch (unsigned 32-bit).
   * @param fraction - Fractional part of the second (unsigned 32-bit).
   * @returns The combined 64-bit NTP timestamp.
   */
  static combine(seconds: number, fraction: number): bigint {
    return (BigInt(seconds >>> 0) << 32n) | BigInt(fraction >>> 0);
  }

  /**
   * Encodes NTP timing-packet fields into a 32-byte big-endian buffer.
   *
   * @param fields - The packet fields to encode.
   * @returns A 32-byte buffer containing the encoded timing packet.
   */
  static encode(fields: NtpPacketFields): Buffer {
    const buffer = Buffer.allocUnsafe(32);

    buffer.writeUInt8(fields.proto, 0);
    buffer.writeUInt8(fields.type, 1);
    buffer.writeUInt16BE(fields.seqno, 2);
    buffer.writeUInt32BE(fields.padding, 4);
    buffer.writeUInt32BE(fields.reftimeSec, 8);
    buffer.writeUInt32BE(fields.reftimeFrac, 12);
    buffer.writeUInt32BE(fields.recvtimeSec, 16);
    buffer.writeUInt32BE(fields.recvtimeFrac, 20);
    buffer.writeUInt32BE(fields.sendtimeSec, 24);
    buffer.writeUInt32BE(fields.sendtimeFrac, 28);

    return buffer;
  }

  /**
   * Decodes an NTP timing packet from a buffer.
   *
   * Requires at least 24 bytes. The send-timestamp fields (bytes 24-31) are
   * optional and default to `0` when the buffer is shorter than 28/32 bytes,
   * matching the shorter timing-request layout observed on the wire.
   *
   * @param buffer - The raw timing packet (minimum 24 bytes).
   * @returns The decoded packet fields.
   * @throws {RangeError} If the buffer is shorter than 24 bytes.
   */
  static decode(buffer: Buffer): NtpPacketFields {
    if (buffer.length < 24) {
      throw new RangeError(
        `NTP packet too small: expected at least 24 bytes, got ${buffer.length}`
      );
    }

    return {
      proto: buffer.readUInt8(0),
      type: buffer.readUInt8(1),
      seqno: buffer.readUInt16BE(2),
      padding: buffer.readUInt32BE(4),
      reftimeSec: buffer.readUInt32BE(8),
      reftimeFrac: buffer.readUInt32BE(12),
      recvtimeSec: buffer.readUInt32BE(16),
      recvtimeFrac: buffer.readUInt32BE(20),
      sendtimeSec: buffer.length >= 28 ? buffer.readUInt32BE(24) : 0,
      sendtimeFrac: buffer.length >= 32 ? buffer.readUInt32BE(28) : 0,
    };
  }
}
