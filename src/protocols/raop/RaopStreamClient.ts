import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { EventEmitter } from "eventemitter3";
import { createLogger } from "@/logging/logging.ts";
import {
  AUDIO_FRAMES_PER_PACKET,
  MAX_PACKETS_COMPENSATE,
  PACKET_BACKLOG_SIZE,
  SLOW_WARNING_THRESHOLD,
} from "./const.ts";
import { PacketFifo } from "./packets/PacketFifo.ts";
import { RtpPacket } from "./packets/RtpPacket.ts";
import type { RaopRtspSession } from "./RaopRtspSession.ts";
import { RaopControlChannel } from "./RaopControlChannel.ts";
import type { AudioSource, MediaMetadata, StreamContext } from "./types.ts";
import { MetadataType } from "./types.ts";
import { pctToDbfs } from "./utils.ts";

const logger = createLogger("bunatv:raop:stream");

export interface RaopStreamClientEvents {
  playing: (info: { metadata: MediaMetadata; position: number }) => void;
  stopped: () => void;
}

const EMPTY_METADATA: MediaMetadata = {
  title: "",
  artist: "",
  album: "",
  duration: 0,
};

const FALLBACK_METADATA: MediaMetadata = {
  title: "BunATV Stream",
  artist: "BunATV",
  album: "AirPlay",
  duration: 0,
};

/**
 * Core RAOP audio streaming engine.
 *
 * Manages the complete streaming lifecycle:
 * 1. Initialization — control channel bind, RTSP ANNOUNCE + SETUP
 * 2. Pre-roll — metadata/artwork/progress via SET_PARAMETER, RECORD, FLUSH
 * 3. Real-time loop — RTP packet pacing, burst compensation, retransmit backlog
 * 4. Teardown — RTSP TEARDOWN, close UDP sockets
 */
export class RaopStreamClient extends EventEmitter<RaopStreamClientEvents> {
  readonly #rtsp: RaopRtspSession;
  readonly #ctx: StreamContext;

  #controlChannel?: RaopControlChannel;
  #packetBacklog = new PacketFifo(PACKET_BACKLOG_SIZE);
  #metadataTypes: MetadataType = MetadataType.NotSupported;
  #metadata: MediaMetadata = EMPTY_METADATA;
  #isPlaying = false;
  #feedbackTimer?: NodeJS.Timeout;

  constructor(rtsp: RaopRtspSession, ctx: StreamContext) {
    super();
    this.#rtsp = rtsp;
    this.#ctx = ctx;
  }

  /**
   * Bind the control channel and send RTSP ANNOUNCE + SETUP.
   *
   * Must be called before `sendAudio`.
   *
   * @param metadataTypes  Bitmask from the device's `md` TXT record.
   * @param requiresAuthSetup  True for AirPort Express MFi-SAP devices.
   */
  async initialize(
    metadataTypes: MetadataType,
    requiresAuthSetup: boolean
  ): Promise<void> {
    this.#metadataTypes = metadataTypes;

    this.#controlChannel = new RaopControlChannel(
      this.#ctx,
      this.#packetBacklog
    );

    // Bind to the local address on an OS-chosen port.
    await this.#controlChannel.bind(this.#rtsp.localAddress, 0);

    logger.debug(
      {
        localAddress: this.#rtsp.localAddress,
        controlPort: this.#controlChannel.port,
        metadataTypes,
      },
      "RAOP control channel ready"
    );

    if (requiresAuthSetup) {
      await this.#rtsp.authSetup();
    }

    await this.#rtsp.announce(
      this.#ctx.sampleRate,
      this.#ctx.channels,
      this.#ctx.bytesPerChannel
    );

    const { serverPort, controlPort } = await this.#rtsp.setupTransport(
      this.#controlChannel.port,
      0 // timing port — we don't run a timing server; send 0
    );

    this.#ctx.serverPort = serverPort;
    this.#ctx.controlPort = controlPort;

    logger.debug({ serverPort, controlPort }, "RAOP transport negotiated");
  }

  /** Signal the streaming loop to stop after the current packet. */
  stop(): void {
    this.#isPlaying = false;
  }

  /** Update the receiver volume via RTSP SET_PARAMETER. */
  async setVolume(volumeDbfs: number): Promise<void> {
    await this.#rtsp.setVolume(this.#ctx.rtspSession, volumeDbfs);
    this.#ctx.volume = volumeDbfs;
  }

  /**
   * Stream audio from `source` to the RAOP receiver.
   *
   * Resets the stream context, connects the UDP audio socket, publishes
   * metadata/artwork/progress, starts RECORD, then enters the real-time
   * packet loop. Always tears down on completion or error.
   */
  async sendAudio(
    source: AudioSource,
    metadata: MediaMetadata = EMPTY_METADATA,
    volumePct?: number
  ): Promise<void> {
    if (!this.#controlChannel) throw new Error("Not initialized");

    this.#ctx.reset();
    this.#metadata = metadata;

    let transport: UdpSocket | undefined;

    try {
      transport = createSocket("udp4");

      await new Promise<void>((resolve, reject) => {
        transport!.once("error", reject);
        transport!.connect(
          this.#ctx.serverPort,
          this.#rtsp.remoteAddress,
          () => {
            transport!.removeListener("error", reject);
            resolve();
          }
        );
      });

      this.#controlChannel.start(this.#rtsp.remoteAddress);

      // Publish progress (start / current / end in RTP timestamp units).
      if ((this.#metadataTypes & MetadataType.Progress) !== 0) {
        const start = this.#ctx.rtptime;
        const end = start + Math.floor(source.duration * this.#ctx.sampleRate);
        await this.#rtsp.setProgress(
          this.#ctx.rtspSession,
          this.#ctx.rtpseq,
          this.#ctx.rtptime,
          start,
          start,
          end
        );
      }

      if ((this.#metadataTypes & MetadataType.Text) !== 0) {
        const effective = this.#isMetadataEmpty(metadata)
          ? FALLBACK_METADATA
          : metadata;
        logger.debug({ title: effective.title }, "Publishing track metadata");
        await this.#rtsp.setMetadata(
          this.#ctx.rtspSession,
          this.#ctx.rtpseq,
          this.#ctx.rtptime,
          effective
        );
      }

      if (
        (this.#metadataTypes & MetadataType.Artwork) !== 0 &&
        metadata.artwork
      ) {
        logger.debug({ bytes: metadata.artwork.length }, "Publishing artwork");
        await this.#rtsp.setArtwork(
          this.#ctx.rtspSession,
          this.#ctx.rtpseq,
          this.#ctx.rtptime,
          metadata.artwork
        );
      }

      this.#startFeedback();

      this.emit("playing", {
        metadata: this.#isMetadataEmpty(metadata)
          ? FALLBACK_METADATA
          : metadata,
        position: this.#ctx.position,
      });

      await this.#rtsp.record(
        this.#ctx.rtspSession,
        this.#ctx.rtpseq,
        this.#ctx.rtptime
      );

      await this.#rtsp.flush(
        this.#ctx.rtspSession,
        this.#ctx.rtpseq,
        this.#ctx.rtptime
      );

      if (volumePct !== undefined) {
        await this.setVolume(pctToDbfs(volumePct));
      }

      await this.#streamLoop(source, transport);
    } catch (err) {
      logger.error({ err }, "RAOP streaming error");
      throw new Error("Streaming failed", { cause: err });
    } finally {
      this.#packetBacklog.clear();
      this.#stopFeedback();

      if (transport) {
        try {
          await this.#rtsp.teardown(this.#ctx.rtspSession);
        } catch {
          /* ignored */
        }
        transport.close();
      }

      this.#controlChannel?.stop();
      this.emit("stopped");
    }
  }

  /** Release control channel resources. */
  close(): void {
    this.#controlChannel?.close();
    this.#controlChannel = undefined;
  }

  // ─── Streaming loop ───────────────────────────────────────────────────────

  async #streamLoop(source: AudioSource, transport: UdpSocket): Promise<void> {
    const startNs = process.hrtime.bigint();
    let totalFrames = 0;
    let intervalFrames = 0;
    let intervalNs = process.hrtime.bigint();
    let prevSlowSeqno: number | null = null;
    let slowCount = 0;

    this.#isPlaying = true;

    while (this.#isPlaying) {
      const seqno = this.#ctx.rtpseq - 1;

      const sent = await this.#sendPacket(source, totalFrames === 0, transport);
      if (sent === 0) break;

      totalFrames += sent;
      intervalFrames += sent;

      // Burst compensation: if we're behind real-time, send extra packets.
      const expectedFrames = this.#expectedFrames(startNs);
      const behind = expectedFrames - totalFrames;

      if (behind >= AUDIO_FRAMES_PER_PACKET) {
        const extra = Math.min(
          Math.floor(behind / AUDIO_FRAMES_PER_PACKET),
          MAX_PACKETS_COMPENSATE
        );
        const [extraSent, hasMore] = await this.#sendBurst(
          source,
          transport,
          extra
        );
        totalFrames += extraSent;
        intervalFrames += extraSent;
        if (!hasMore) break;
      }

      // Log throughput every ~1 second.
      if (intervalFrames >= this.#ctx.sampleRate) {
        const nowNs = process.hrtime.bigint();
        const elapsedMs = Number(nowNs - intervalNs) / 1e6;
        logger.debug(
          { frames: intervalFrames, ms: elapsedMs.toFixed(0) },
          "RAOP interval"
        );
        intervalFrames = 0;
        intervalNs = nowNs;
      }

      // Sleep until it's time to send the next packet.
      const audioTimeSec = totalFrames / this.#ctx.sampleRate;
      const wallTimeSec = Number(process.hrtime.bigint() - startNs) / 1e9;
      const sleepMs = (audioTimeSec - wallTimeSec) * 1000;

      if (sleepMs > 0) {
        slowCount = 0;
        await new Promise<void>((r) => setTimeout(r, sleepMs));
      } else {
        if (prevSlowSeqno === seqno - 1) slowCount++;
        if (slowCount >= SLOW_WARNING_THRESHOLD) {
          logger.warn(
            {
              seqno,
              audio: audioTimeSec.toFixed(3),
              wall: wallTimeSec.toFixed(3),
            },
            "RAOP sender too slow"
          );
        } else {
          logger.debug(
            { seqno, behindMs: (-sleepMs).toFixed(0) },
            "Sender behind"
          );
        }
        prevSlowSeqno = seqno;
      }
    }

    const totalMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    logger.debug(
      { frames: totalFrames, ms: totalMs.toFixed(0) },
      "RAOP stream complete"
    );
  }

  async #sendPacket(
    source: AudioSource,
    firstPacket: boolean,
    transport: UdpSocket
  ): Promise<number> {
    if (this.#ctx.paddingSent >= this.#ctx.latency) return 0;

    let frames = await source.readFrames(AUDIO_FRAMES_PER_PACKET);

    if (!frames) {
      frames = Buffer.alloc(this.#ctx.packetSize);
      this.#ctx.paddingSent += Math.floor(frames.length / this.#ctx.frameSize);
    } else if (frames.length !== this.#ctx.packetSize) {
      const padded = Buffer.alloc(this.#ctx.packetSize);
      frames.copy(padded);
      frames = padded;
    }

    const header = RtpPacket.encode(
      0x80,
      firstPacket ? 0xe0 : 0x60,
      this.#ctx.rtpseq,
      this.#ctx.headTs,
      this.#rtsp.sessionId
    );

    const packet = Buffer.concat([header, frames]);
    const seqno = header.readUInt16BE(2);

    await new Promise<void>((resolve, reject) => {
      transport.send(packet, (err) => (err ? reject(err) : resolve()));
    });

    this.#packetBacklog.set(seqno, packet);

    this.#ctx.rtpseq = (this.#ctx.rtpseq + 1) % 0x10000;
    this.#ctx.headTs =
      (this.#ctx.headTs + Math.floor(frames.length / this.#ctx.frameSize)) >>>
      0;

    return Math.floor(frames.length / this.#ctx.frameSize);
  }

  async #sendBurst(
    source: AudioSource,
    transport: UdpSocket,
    count: number
  ): Promise<[framesTotal: number, hasMore: boolean]> {
    let total = 0;
    for (let i = 0; i < count; i++) {
      const sent = await this.#sendPacket(source, false, transport);
      total += sent;
      if (sent === 0) return [total, false];
    }
    return [total, true];
  }

  #expectedFrames(startNs: bigint): number {
    const elapsedNs = Number(process.hrtime.bigint() - startNs);
    return Math.floor(elapsedNs / (1e9 / this.#ctx.sampleRate));
  }

  #isMetadataEmpty(m: MediaMetadata): boolean {
    return (
      m.title === "" && m.artist === "" && m.album === "" && m.duration === 0
    );
  }

  // ─── Feedback keep-alive ──────────────────────────────────────────────────

  #startFeedback(): void {
    this.#feedbackTimer = setInterval(async () => {
      try {
        await this.#rtsp.feedback();
      } catch (err) {
        logger.warn({ err }, "Feedback failed");
      }
    }, 2000);
  }

  #stopFeedback(): void {
    if (this.#feedbackTimer) {
      clearInterval(this.#feedbackTimer);
      this.#feedbackTimer = undefined;
    }
  }
}
