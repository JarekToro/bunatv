/** CD-quality sample rate used as the RAOP default. */
export const AUDIO_SAMPLE_RATE = 44100;
/** Stereo channels. */
export const AUDIO_CHANNELS = 2;
/** 16-bit samples → 2 bytes per channel. */
export const AUDIO_BYTES_PER_CHANNEL = 2;
/** L16 RAOP frames per RTP packet (standard Apple value). */
export const AUDIO_FRAMES_PER_PACKET = 352;

/** Packets to keep in the retransmit backlog. */
export const PACKET_BACKLOG_SIZE = 1000;
/** Extra packets sent in a burst when falling behind real-time. */
export const MAX_PACKETS_COMPENSATE = 3;
/** Consecutive slow seqnos before a warning is logged instead of debug. */
export const SLOW_WARNING_THRESHOLD = 5;

/** Default volume (dBFS) used when no explicit volume is requested. */
export const DEFAULT_VOLUME_DBFS = -20;
/** Buffering latency expressed as a multiple of the sample rate (2 s). */
export const DEFAULT_LATENCY_SECONDS = 2;

/** Static Curve25519 public key sent during /auth-setup for MFi-SAP devices. */
export const CURVE25519_PUB_KEY = Buffer.from([
  0x59, 0x02, 0xed, 0xe9, 0x0d, 0x4e, 0xf2, 0xbd, 0x4c, 0xb6, 0x8a, 0x63, 0x30,
  0x03, 0x82, 0x07, 0xa9, 0x4d, 0xbd, 0x50, 0xd8, 0xaa, 0x46, 0x5b, 0x5d, 0x8c,
  0x01, 0x2a, 0x0c, 0x7e, 0x1d, 0x4e,
]);
