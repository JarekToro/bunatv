import { EventEmitter } from "eventemitter3";
import { createLogger } from "@/logging/logging.ts";
import type { RAOPService } from "@/core/discovery/discovery-types.ts";
import {
  AUDIO_BYTES_PER_CHANNEL,
  AUDIO_CHANNELS,
  AUDIO_FRAMES_PER_PACKET,
  AUDIO_SAMPLE_RATE,
  DEFAULT_LATENCY_SECONDS,
  DEFAULT_VOLUME_DBFS,
} from "./const.ts";
import { RaopRtspSession } from "./RaopRtspSession.ts";
import { RaopStreamClient } from "./RaopStreamClient.ts";
import type { AudioSource, MediaMetadata, StreamContext } from "./types.ts";
import { EncryptionType, MetadataType } from "./types.ts";
import {
  parseAudioProperties,
  parseEncryptionTypes,
  parseMetadataTypes,
  pctToDbfs,
} from "./utils.ts";

const logger = createLogger("bunatv:raop:client");

export interface StreamOptions {
  readonly metadata?: MediaMetadata;
  /** Initial volume as a percentage 0–100. */
  readonly volume?: number;
  /** Password for Digest-protected receivers. */
  readonly password?: string;
}

export interface RaopClientEvents {
  playing: (info: { metadata: MediaMetadata; position: number }) => void;
  stopped: () => void;
}

/**
 * High-level RAOP (Remote Audio Output Protocol) client.
 *
 * Streams raw PCM audio to an AirPlay 1/RAOP receiver discovered via mDNS.
 * The caller is responsible for providing an `AudioSource` that yields
 * interleaved 16-bit PCM frames at the stream's sample rate.
 *
 * @example
 * ```ts
 * const [device] = await discovery.findAll();
 * const client = await RaopClient.create(device.services.raop!);
 *
 * await client.stream(myAudioSource, { volume: 50 });
 * await client.close();
 * ```
 */
export class RaopClient extends EventEmitter<RaopClientEvents> {
  readonly #rtsp: RaopRtspSession;
  readonly #streamClient: RaopStreamClient;
  readonly #deviceName: string;

  private constructor(
    rtsp: RaopRtspSession,
    streamClient: RaopStreamClient,
    deviceName: string
  ) {
    super();
    this.#rtsp = rtsp;
    this.#streamClient = streamClient;
    this.#deviceName = deviceName;

    this.#streamClient.on("playing", (info) => this.emit("playing", info));
    this.#streamClient.on("stopped", () => this.emit("stopped"));
  }

  /** Name of the receiver device (from the mDNS instance name). */
  get deviceName(): string {
    return this.#deviceName;
  }

  /**
   * Stream audio from `source` to the receiver.
   *
   * Starts the source, streams all audio, then stops the source. The
   * promise resolves (or rejects) once the stream is fully torn down.
   *
   * @param source   Audio data provider.
   * @param options  Optional metadata, volume, and password.
   */
  async stream(
    source: AudioSource,
    options: StreamOptions = {}
  ): Promise<void> {
    await source.start();
    try {
      await this.#streamClient.sendAudio(
        source,
        options.metadata,
        options.volume
      );
    } finally {
      await source.stop();
    }
  }

  /** Signal the stream to stop after the current packet. */
  stop(): void {
    this.#streamClient.stop();
  }

  /**
   * Set the receiver volume.
   *
   * @param volumeDbfs Volume in dBFS (−144 = silent, 0 = full).
   */
  async setVolume(volumeDbfs: number): Promise<void> {
    await this.#streamClient.setVolume(volumeDbfs);
  }

  /**
   * Set the receiver volume using a 0–100 percentage.
   */
  async setVolumePercent(pct: number): Promise<void> {
    await this.#streamClient.setVolume(pctToDbfs(pct));
  }

  /**
   * Disconnect and release all resources.
   * Must be called after streaming is finished.
   */
  async close(): Promise<void> {
    this.#streamClient.close();
    await this.#rtsp.disconnect();
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  /**
   * Connect to a RAOP receiver discovered via mDNS and return a ready client.
   *
   * Reads the TXT record to determine supported encryption, metadata, and
   * audio format. Negotiates RTSP ANNOUNCE + SETUP before returning.
   *
   * @param service     The `RAOPService` instance from mDNS discovery.
   * @param options     Optional stream options (password, volume).
   */
  static async create(
    service: RAOPService,
    options: Pick<StreamOptions, "password"> = {}
  ): Promise<RaopClient> {
    const { hostname, port, instanceName, txt } = service;

    logger.debug(
      { host: hostname, port, instanceName },
      "Connecting to RAOP device"
    );

    const rtsp = new RaopRtspSession(hostname, port);
    await rtsp.connect();

    // Parse device capabilities from TXT record.
    const props = new Map<string, string>(
      Object.entries(txt).filter(([, v]) => v !== undefined) as [
        string,
        string,
      ][]
    );

    const encryptionTypes = parseEncryptionTypes(props);
    const metadataTypes = parseMetadataTypes(props);
    const [sampleRate, channels, bytesPerChannel] = parseAudioProperties(props);

    logger.debug(
      {
        sampleRate,
        channels,
        bitsPerChannel: bytesPerChannel * 8,
        encryptionTypes,
        metadataTypes,
      },
      "RAOP device properties"
    );

    const ctx = createStreamContext(sampleRate, channels, bytesPerChannel);
    ctx.rtspSession = RaopRtspSession.generateSessionId();

    const streamClient = new RaopStreamClient(rtsp, ctx);

    // MFi-SAP auth-setup is only needed for AirPort Express devices.
    const modelName = props.get("am") ?? "";
    const requiresAuthSetup =
      (encryptionTypes & EncryptionType.MFiSAP) !== 0 &&
      modelName.startsWith("AirPort");

    await streamClient.initialize(metadataTypes, requiresAuthSetup);

    return new RaopClient(rtsp, streamClient, instanceName);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createStreamContext(
  sampleRate: number,
  channels: number,
  bytesPerChannel: number
): StreamContext {
  const rtptime = Math.floor(Math.random() * 0xffffffff);
  const frameSize = channels * bytesPerChannel;

  return {
    sampleRate,
    channels,
    bytesPerChannel,
    rtpseq: Math.floor(Math.random() * 65536),
    rtptime,
    headTs: rtptime,
    latency: Math.floor(sampleRate * DEFAULT_LATENCY_SECONDS),
    serverPort: 0,
    controlPort: 0,
    rtspSession: "",
    volume: DEFAULT_VOLUME_DBFS,
    position: 0,
    packetSize: AUDIO_FRAMES_PER_PACKET * frameSize,
    frameSize,
    paddingSent: 0,

    reset() {
      this.rtpseq = Math.floor(Math.random() * 65536);
      this.rtptime = Math.floor(Math.random() * 0xffffffff);
      this.headTs = this.rtptime;
      this.paddingSent = 0;
      this.position = 0;
    },
  };
}
