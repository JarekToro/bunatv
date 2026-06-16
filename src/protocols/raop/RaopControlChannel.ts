import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { NTP } from "@/core/encoding/ntp.ts";
import { createLogger } from "@/logging/logging.ts";
import { PacketFifo } from "./packets/PacketFifo.ts";
import { SyncPacket, decodeRetransmitRequest } from "./packets/SyncPacket.ts";
import type { StreamContext } from "./types.ts";

const logger = createLogger("bunatv:raop:control");

/**
 * Convert an RTP timestamp to a 64-bit NTP wall-clock value.
 *
 * Uses a fixed anchor pair (RTP timestamp ↔ NTP wall-clock) established
 * when the stream starts. 32-bit unsigned wrap-around is handled explicitly.
 */
function ntpFromRtp(
  rtpTs: number,
  sampleRate: number,
  anchorRtp: number,
  anchorNtp: bigint
): bigint {
  let elapsed: number;
  if (rtpTs >= anchorRtp) {
    elapsed = rtpTs - anchorRtp;
  } else {
    // 32-bit unsigned wrap
    elapsed = 0x100000000 - anchorRtp + rtpTs;
  }

  const elapsedSecs = Math.floor(elapsed / sampleRate);
  const elapsedFrac = ((elapsed % sampleRate) * 0xffffffff) / sampleRate;
  const elapsedNtp =
    (BigInt(elapsedSecs) << 32n) | BigInt(Math.floor(elapsedFrac));

  return anchorNtp + elapsedNtp;
}

/**
 * UDP control channel for a RAOP stream.
 *
 * Responsibilities:
 * 1. Send periodic 20-byte sync packets to keep the receiver's playback
 *    clock aligned with the sender's RTP timestamps.
 * 2. Handle retransmit requests (type 0x55) from the receiver by resending
 *    lost packets from the retransmit backlog.
 */
export class RaopControlChannel {
  readonly #context: StreamContext;
  readonly #packetBacklog: PacketFifo;

  #transport?: UdpSocket;
  #syncTimer?: NodeJS.Timeout;
  #localPort?: number;
  #anchorRtp = 0;
  #anchorNtp = 0n;

  constructor(context: StreamContext, packetBacklog: PacketFifo) {
    this.#context = context;
    this.#packetBacklog = packetBacklog;
  }

  /** Local UDP port assigned after `bind()`. */
  get port(): number {
    return this.#localPort ?? 0;
  }

  /**
   * Bind a UDP socket to `localIp:port`.
   * Pass `port = 0` to let the OS choose a free port.
   */
  bind(localIp: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#transport = createSocket("udp4");

      this.#transport.on("error", (err) => {
        logger.error({ err }, "Control channel UDP error");
        reject(err);
      });

      this.#transport.on("message", (data, rinfo) => {
        this.#onMessage(data, rinfo);
      });

      this.#transport.on("listening", () => {
        this.#localPort = this.#transport!.address().port;
        logger.debug({ port: this.#localPort }, "Control channel bound");
        resolve();
      });

      this.#transport.bind(port, localIp);
    });
  }

  /**
   * Start sending sync packets to `remoteAddr:context.controlPort` once
   * per second. The first packet carries the marker bit (0x90).
   *
   * An anchor NTP ↔ RTP pair is established at start time so that
   * `ntpFromRtp` can produce accurate wall-clock sync timestamps.
   */
  start(remoteAddr: string): void {
    if (this.#syncTimer) throw new Error("Already running");

    this.#anchorRtp = this.#context.headTs;
    this.#anchorNtp = NTP.now();

    let first = true;

    const send = () => {
      if (!this.#transport) return;

      const currentNtp = ntpFromRtp(
        this.#context.headTs,
        this.#context.sampleRate,
        this.#anchorRtp,
        this.#anchorNtp
      );
      const [ntpSec, ntpFrac] = NTP.parts(currentNtp);

      const packet = SyncPacket.encode(
        first ? 0x90 : 0x80,
        0xd4,
        0x0007,
        (this.#context.headTs - this.#context.latency) >>> 0,
        ntpSec,
        ntpFrac,
        this.#context.headTs
      );

      first = false;
      this.#transport.send(packet, this.#context.controlPort, remoteAddr);
    };

    send();
    this.#syncTimer = setInterval(send, 1000);
  }

  /** Stop sending sync packets (does not close the UDP socket). */
  stop(): void {
    if (this.#syncTimer) {
      clearInterval(this.#syncTimer);
      this.#syncTimer = undefined;
    }
  }

  /** Stop sync packets and close the UDP socket. */
  close(): void {
    this.stop();
    if (this.#transport) {
      this.#transport.close();
      this.#transport = undefined;
    }
  }

  // ─── Incoming messages ────────────────────────────────────────────────────

  #onMessage(data: Buffer, rinfo: { address: string; port: number }): void {
    const type = data[1]! & 0x7f;

    if (type === 0x55) {
      this.#handleRetransmit(decodeRetransmitRequest(data), rinfo);
    } else {
      logger.debug(
        { type: type.toString(16), rinfo },
        "Unhandled control message"
      );
    }
  }

  #handleRetransmit(
    req: { lostSeqno: number; lostPackets: number },
    addr: { address: string; port: number }
  ): void {
    for (let i = 0; i < req.lostPackets; i++) {
      const seqno = (req.lostSeqno + i) & 0xffff;

      if (this.#packetBacklog.has(seqno)) {
        const original = this.#packetBacklog.get(seqno)!;

        if (original.byteLength < 4) continue;

        // Re-wrap in retransmit response header (type 0xD6).
        const origSeqno = original.subarray(2, 4);
        const resp = Buffer.concat([
          Buffer.from([0x80, 0xd6]),
          origSeqno,
          original,
        ]);
        this.#transport?.send(resp, addr.port, addr.address);
      } else {
        // Futile: packet no longer in backlog — acknowledge with empty response.
        const seqBuf = Buffer.alloc(2);
        seqBuf.writeUInt16BE(seqno, 0);
        const resp = Buffer.concat([
          Buffer.from([0x80, 0xd6]),
          seqBuf,
          Buffer.alloc(4),
        ]);
        this.#transport?.send(resp, addr.port, addr.address);
      }
    }
  }
}
