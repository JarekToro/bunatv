import { createHash } from "node:crypto";
import { BunTCPTransport } from "@/protocols/shared/layers/BunTCPTransport.ts";
import { ChaCha20EncryptionLayer } from "@/protocols/shared/layers/ChaCha20EncryptionLayer.ts";
import {
  HttpFramedChannel,
  type HttpResponse,
} from "@/protocols/airplay/layers/HttpFramedChannel.ts";
import { DAAP } from "@/core/encoding/daap.ts";
import { createLogger } from "@/logging/logging.ts";
import {
  AUDIO_BYTES_PER_CHANNEL,
  AUDIO_CHANNELS,
  AUDIO_FRAMES_PER_PACKET,
  CURVE25519_PUB_KEY,
} from "./const.ts";
import type { MediaMetadata } from "./types.ts";

const logger = createLogger("bunatv:raop:rtsp");

const USER_AGENT = "AirPlay/550.10";

interface DigestInfo {
  readonly username: string;
  readonly realm: string;
  readonly password: string;
  readonly nonce: string;
}

function digestPayload(method: string, uri: string, info: DigestInfo): string {
  const ha1 = createHash("md5")
    .update(`${info.username}:${info.realm}:${info.password}`)
    .digest("hex");
  const ha2 = createHash("md5").update(`${method}:${uri}`).digest("hex");
  const response = createHash("md5")
    .update(`${ha1}:${info.nonce}:${ha2}`)
    .digest("hex");

  return (
    `Digest username="${info.username}", realm="${info.realm}", ` +
    `nonce="${info.nonce}", uri="${uri}", response="${response}"`
  );
}

/**
 * Build the SDP body for RTSP ANNOUNCE.
 *
 * Uses L16 (raw PCM) at 44100 Hz, stereo. The fmtp line follows the
 * Apple RAOP convention: `a=fmtp:96 <framesPerPacket> 0 <bitsPerChannel>
 * 40 10 14 <channels> 255 0 0 <sampleRate>`.
 */
function buildSdp(
  sessionId: number,
  localIp: string,
  remoteIp: string,
  sampleRate: number,
  channels: number,
  bytesPerChannel: number
): string {
  const bitsPerChannel = bytesPerChannel * 8;
  return (
    [
      "v=0",
      `o=iTunes ${sessionId} 0 IN IP4 ${localIp}`,
      "s=iTunes",
      `c=IN IP4 ${remoteIp}`,
      "t=0 0",
      "m=audio 0 RTP/AVP 96",
      `a=rtpmap:96 L16/${sampleRate}/${channels}`,
      `a=fmtp:96 ${AUDIO_FRAMES_PER_PACKET} 0 ${bitsPerChannel} 40 10 14 ${channels} 255 0 0 ${sampleRate}`,
    ].join("\r\n") + "\r\n"
  );
}

/**
 * RAOP-specific RTSP client.
 *
 * Opens a plain TCP connection to the RAOP port of the receiver and
 * drives the full RAOP RTSP lifecycle: ANNOUNCE → SETUP → RECORD →
 * streaming loop (SET_PARAMETER) → TEARDOWN.
 *
 * The connection is unencrypted (RAOP 1.x uses no HAP layer). For
 * AirPort Express MFi-SAP devices, `authSetup()` must be called between
 * ANNOUNCE and SETUP.
 */
export class RaopRtspSession {
  readonly #transport: BunTCPTransport;
  readonly #channel: HttpFramedChannel;
  readonly #address: string;
  readonly #port: number;

  readonly #sessionId: number;
  readonly #dacpId: string;
  readonly #activeRemote: number;

  #cseq = -1;
  #digestInfo?: DigestInfo;

  constructor(address: string, port: number) {
    this.#address = address;
    this.#port = port;
    this.#sessionId = Math.floor(Math.random() * 0xffffffff);
    this.#dacpId = this.#generateDacpId();
    this.#activeRemote = Math.floor(Math.random() * 0xffffffff);

    this.#transport = new BunTCPTransport();
    // Encryption is disabled by default — RAOP is unencrypted.
    const enc = new ChaCha20EncryptionLayer();
    this.#channel = new HttpFramedChannel(this.#transport, enc);
  }

  get sessionId(): number {
    return this.#sessionId;
  }

  /** RTSP URI for this session (used in method paths). */
  get sessionUrl(): string {
    return `rtsp://${this.localAddress}/${this.#sessionId}`;
  }

  get localAddress(): string {
    return this.#channel.localAddress ?? "127.0.0.1";
  }

  get remoteAddress(): string {
    return this.#address;
  }

  async connect(): Promise<void> {
    await this.#transport.connect(this.#address, this.#port);
    logger.debug(
      { address: this.#address, port: this.#port },
      "RAOP RTSP connected"
    );
  }

  async disconnect(): Promise<void> {
    await this.#transport.disconnect("RaopRtspSession closed");
  }

  // ─── RTSP primitives ──────────────────────────────────────────────────────

  async #request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: Buffer
  ): Promise<HttpResponse> {
    this.#cseq++;

    const base: Record<string, string> = {
      CSeq: String(this.#cseq),
      "User-Agent": USER_AGENT,
      "DACP-ID": this.#dacpId,
      "Active-Remote": String(this.#activeRemote),
      "Client-Instance": this.#dacpId,
    };

    if (this.#digestInfo) {
      base["Authorization"] = digestPayload(method, path, this.#digestInfo);
    }

    const merged = { ...base, ...headers };

    const response = await this.#channel.sendRequest(
      method,
      path,
      merged,
      body,
      "RTSP/1.0"
    );

    const responseCseq = response.headers.get("cseq");
    if (responseCseq && parseInt(responseCseq, 10) !== this.#cseq) {
      logger.warn({ expected: this.#cseq, got: responseCseq }, "CSeq mismatch");
    }

    return response;
  }

  // ─── RAOP lifecycle ───────────────────────────────────────────────────────

  /**
   * RTSP ANNOUNCE — describes the audio format to the receiver.
   * If the device responds with a 401 and a password is provided,
   * retries automatically with HTTP Digest authentication.
   */
  async announce(
    sampleRate: number,
    channels: number,
    bytesPerChannel: number,
    password?: string
  ): Promise<void> {
    const sdp = buildSdp(
      this.#sessionId,
      this.localAddress,
      this.#address,
      sampleRate,
      channels,
      bytesPerChannel
    );
    const body = Buffer.from(sdp, "utf-8");

    logger.debug({ sessionUrl: this.sessionUrl, sdp }, "Sending ANNOUNCE");

    let response = await this.#request(
      "ANNOUNCE",
      this.sessionUrl,
      { "Content-Type": "application/sdp" },
      body
    );

    if (response.statusCode === 401 && password) {
      const wwwAuth = response.headers.get("www-authenticate") ?? "";
      const parts = wwwAuth.split('"');
      if (parts.length >= 5) {
        this.#digestInfo = {
          username: "bunatv",
          realm: parts[1]!,
          password,
          nonce: parts[3]!,
        };
        response = await this.#request(
          "ANNOUNCE",
          this.sessionUrl,
          { "Content-Type": "application/sdp" },
          body
        );
      }
    }

    if (response.statusCode !== 200) {
      throw new Error(
        `RAOP ANNOUNCE failed: ${response.statusCode} ${response.statusText}`
      );
    }
  }

  /**
   * RTSP SETUP — negotiate UDP transport ports with the receiver.
   * Returns the server-assigned audio port and control port.
   */
  async setupTransport(
    localControlPort: number,
    localTimingPort: number
  ): Promise<{ serverPort: number; controlPort: number }> {
    const transport = [
      "RTP/AVP/UDP",
      "unicast",
      "interleaved=0-1",
      "mode=record",
      `control_port=${localControlPort}`,
      `timing_port=${localTimingPort}`,
    ].join(";");

    const response = await this.#request("SETUP", this.sessionUrl, {
      Transport: transport,
    });

    if (response.statusCode !== 200) {
      throw new Error(
        `RAOP SETUP failed: ${response.statusCode} ${response.statusText}`
      );
    }

    const transportHeader = response.headers.get("transport") ?? "";
    const serverPort = parseInt(
      transportHeader.match(/server_port=(\d+)/)?.[1] ?? "0",
      10
    );
    const controlPort = parseInt(
      transportHeader.match(/control_port=(\d+)/)?.[1] ?? "0",
      10
    );

    logger.debug({ serverPort, controlPort }, "RAOP SETUP complete");

    return { serverPort, controlPort };
  }

  /**
   * MFi-SAP /auth-setup — required only for AirPort Express devices.
   * Sends a static Curve25519 public key; the receiver's response is ignored.
   */
  async authSetup(): Promise<void> {
    const body = Buffer.concat([Buffer.from([0x01]), CURVE25519_PUB_KEY]);
    const response = await this.#request(
      "POST",
      "/auth-setup",
      {
        "Content-Type": "application/octet-stream",
      },
      body
    );

    if (response.statusCode !== 200) {
      throw new Error(
        `auth-setup failed: ${response.statusCode} ${response.statusText}`
      );
    }
  }

  /** RTSP RECORD — starts audio streaming. */
  async record(
    session: string,
    rtpseq: number,
    rtptime: number
  ): Promise<void> {
    await this.#request("RECORD", this.sessionUrl, {
      Range: "npt=0-",
      Session: session,
      "RTP-Info": `seq=${rtpseq};rtptime=${rtptime}`,
    });
  }

  /** RTSP FLUSH — clears the receiver buffer and resets to the given position. */
  async flush(session: string, rtpseq: number, rtptime: number): Promise<void> {
    await this.#request("FLUSH", this.sessionUrl, {
      Range: "npt=0-",
      Session: session,
      "RTP-Info": `seq=${rtpseq};rtptime=${rtptime}`,
    });
  }

  /** RTSP SET_PARAMETER — publish volume (dBFS). */
  async setVolume(session: string, volumeDbfs: number): Promise<void> {
    const body = Buffer.from(`volume: ${volumeDbfs.toFixed(6)}\n`, "utf-8");
    await this.#request(
      "SET_PARAMETER",
      this.sessionUrl,
      {
        Session: session,
        "Content-Type": "text/parameters",
      },
      body
    );
  }

  /** RTSP SET_PARAMETER — publish playback progress. */
  async setProgress(
    session: string,
    rtpseq: number,
    rtptime: number,
    start: number,
    current: number,
    end: number
  ): Promise<void> {
    const body = Buffer.from(`progress: ${start}/${current}/${end}\n`, "utf-8");
    await this.#request(
      "SET_PARAMETER",
      this.sessionUrl,
      {
        Session: session,
        "RTP-Info": `seq=${rtpseq};rtptime=${rtptime}`,
        "Content-Type": "text/parameters",
      },
      body
    );
  }

  /**
   * RTSP SET_PARAMETER — publish DAAP-encoded track metadata (title, artist,
   * album, duration). Content-Type is `application/x-dmap-tagged`.
   */
  async setMetadata(
    session: string,
    rtpseq: number,
    rtptime: number,
    metadata: MediaMetadata
  ): Promise<void> {
    const body = DAAP.encodeTrackMetadata({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      duration: metadata.duration,
    });

    await this.#request(
      "SET_PARAMETER",
      this.sessionUrl,
      {
        Session: session,
        "RTP-Info": `seq=${rtpseq};rtptime=${rtptime}`,
        "Content-Type": "application/x-dmap-tagged",
      },
      Buffer.from(body)
    );
  }

  /**
   * RTSP SET_PARAMETER — send album artwork.
   * Automatically detects PNG (0x89 0x50 magic bytes); defaults to JPEG.
   */
  async setArtwork(
    session: string,
    rtpseq: number,
    rtptime: number,
    artwork: Buffer
  ): Promise<void> {
    const contentType =
      artwork[0] === 0x89 && artwork[1] === 0x50 ? "image/png" : "image/jpeg";

    await this.#request(
      "SET_PARAMETER",
      this.sessionUrl,
      {
        Session: session,
        "RTP-Info": `seq=${rtpseq};rtptime=${rtptime}`,
        "Content-Type": contentType,
      },
      artwork
    );
  }

  /**
   * Periodic POST /feedback — keeps the RTSP session alive during streaming.
   * Errors are swallowed; the caller decides whether to stop on failure.
   */
  async feedback(): Promise<void> {
    try {
      this.#cseq++;
      await this.#channel.sendRequest(
        "POST",
        "/feedback",
        {
          CSeq: String(this.#cseq),
          "User-Agent": USER_AGENT,
        },
        undefined,
        "RTSP/1.0"
      );
    } catch {
      // Feedback errors are non-fatal during streaming.
    }
  }

  /** RTSP TEARDOWN — ends the session and releases server resources. */
  async teardown(session: string): Promise<void> {
    try {
      await this.#request("TEARDOWN", this.sessionUrl, { Session: session });
    } catch {
      // Ignore teardown errors — we're closing anyway.
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  #generateDacpId(): string {
    const hi = Math.floor(Math.random() * 0xffffffff);
    const lo = Math.floor(Math.random() * 0xffffffff);
    return ((BigInt(hi) << 32n) | BigInt(lo)).toString(16).toUpperCase();
  }

  /** Build a unique RTSP session identifier string. */
  static generateSessionId(): string {
    return Math.floor(Math.random() * 0xffffffff).toString();
  }
}

/** Exported separately so that the SDP builder can be unit-tested. */
export { buildSdp };

export { AUDIO_CHANNELS, AUDIO_BYTES_PER_CHANNEL };
