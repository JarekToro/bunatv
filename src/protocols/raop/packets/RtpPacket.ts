/**
 * Encoder for the 12-byte RTP fixed header used in RAOP audio packets.
 *
 * Field layout (big-endian):
 *   [0]     header byte  — version/padding/extension flags (typically 0x80)
 *   [1]     payload type — 0xE0 for first packet, 0x60 for subsequent
 *   [2-3]   sequence number (16-bit)
 *   [4-7]   RTP timestamp (32-bit)
 *   [8-11]  SSRC / session ID (32-bit)
 */
export const RtpPacket = {
  encode(
    header: number,
    payloadType: number,
    seqno: number,
    timestamp: number,
    ssrc: number
  ): Buffer {
    const buf = Buffer.allocUnsafe(12);
    buf.writeUInt8(header, 0);
    buf.writeUInt8(payloadType, 1);
    buf.writeUInt16BE(seqno, 2);
    buf.writeUInt32BE(timestamp, 4);
    buf.writeUInt32BE(ssrc, 8);
    return buf;
  },
};
