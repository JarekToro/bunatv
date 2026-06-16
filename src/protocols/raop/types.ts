/**
 * Metadata for the currently streaming track.
 */
export interface MediaMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  /** Duration in seconds (0 when unknown). */
  readonly duration: number;
  /** Optional album artwork (JPEG or PNG). */
  readonly artwork?: Buffer;
}

/**
 * Provider of raw interleaved PCM audio frames.
 *
 * Each call to `readFrames` must return exactly `frameCount` stereo 16-bit
 * samples (= `frameCount * channels * bytesPerChannel` bytes) or `null` when
 * the source is exhausted.
 */
export interface AudioSource {
  /** Total duration in seconds; use `0` when unknown or streaming. */
  readonly duration: number;
  /** Open the source (files, decoders, network sockets). */
  start(): Promise<void>;
  /** Close the source and release resources. */
  stop(): Promise<void>;
  /**
   * Read up to `frameCount` PCM frames.
   * Returns `null` when the source is exhausted.
   */
  readFrames(frameCount: number): Promise<Buffer | null>;
}

/**
 * Mutable RTP / audio-format state shared across all RAOP components.
 */
export interface StreamContext {
  sampleRate: number;
  channels: number;
  bytesPerChannel: number;
  /** Current RTP sequence number (wraps at 16 bits). */
  rtpseq: number;
  /** Initial RTP timestamp stored in RECORD/FLUSH headers. */
  rtptime: number;
  /** Head timestamp of the latest sent audio frame. */
  headTs: number;
  /** Buffering latency in audio frames (typically 2 s × sampleRate). */
  latency: number;
  /** Server audio UDP port negotiated during SETUP. */
  serverPort: number;
  /** Server control UDP port negotiated during SETUP. */
  controlPort: number;
  /** RTSP session identifier string. */
  rtspSession: string;
  /** Current volume in dBFS. */
  volume: number;
  position: number;
  /** Bytes in one RTP audio payload (framesPerPacket * frameSize). */
  packetSize: number;
  /** Bytes per audio frame (channels * bytesPerChannel). */
  frameSize: number;
  /** Silence padding frames sent after source exhaustion. */
  paddingSent: number;
  /** Reset RTP counters for a fresh stream. */
  reset(): void;
}

/**
 * Bitmask of encryption modes advertised by a RAOP receiver in its mDNS TXT record (`et`).
 */
export enum EncryptionType {
  Unknown = 0,
  Unencrypted = 1 << 0,
  MFiSAP = 1 << 1,
}

/**
 * Bitmask of metadata types advertised by a RAOP receiver in its mDNS TXT record (`md`).
 */
export enum MetadataType {
  NotSupported = 0,
  Text = 1 << 0,
  Artwork = 1 << 1,
  Progress = 1 << 2,
}
