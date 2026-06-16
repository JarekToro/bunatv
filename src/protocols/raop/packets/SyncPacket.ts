/**
 * 20-byte RAOP timing synchronisation packet sent periodically over
 * the UDP control channel to keep the receiver's playback clock aligned
 * with the sender's RTP timestamps.
 *
 * Field layout (big-endian):
 *   [0]     header byte  — 0x90 for first sync, 0x80 for subsequent
 *   [1]     payload type — 0xD4
 *   [2-3]   seqno (16-bit, typically 0x0007)
 *   [4-7]   RTP timestamp of next frame to play, minus latency
 *   [8-11]  NTP wall-clock seconds
 *   [12-15] NTP wall-clock fractional seconds
 *   [16-19] RTP timestamp corresponding to the current head position
 */
export const SyncPacket = {
  encode(
    header: number,
    payloadType: number,
    seqno: number,
    rtpTimestamp: number,
    ntpSec: number,
    ntpFrac: number,
    rtpTimestampNow: number
  ): Buffer {
    const buf = Buffer.allocUnsafe(20);
    buf.writeUInt8(header, 0);
    buf.writeUInt8(payloadType, 1);
    buf.writeUInt16BE(seqno, 2);
    buf.writeUInt32BE(rtpTimestamp, 4);
    buf.writeUInt32BE(ntpSec, 8);
    buf.writeUInt32BE(ntpFrac, 12);
    buf.writeUInt32BE(rtpTimestampNow, 16);
    return buf;
  },
};

/** Retransmit request decoded from a UDP control-channel packet (type 0x55). */
export interface RetransmitRequest {
  readonly lostSeqno: number;
  readonly lostPackets: number;
}

/**
 * Decode a retransmit request from the receiver.
 * Bytes 4-5: first lost sequence number; bytes 6-7: count of lost packets.
 */
export function decodeRetransmitRequest(data: Buffer): RetransmitRequest {
  return {
    lostSeqno: data.readUInt16BE(4),
    lostPackets: data.readUInt16BE(6),
  };
}
