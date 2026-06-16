/**
 * RaopApi - Device-bound entry point for RAOP (AirPlay 1) audio streaming.
 *
 * Unlike the Companion and MRP APIs, RAOP is not a long-lived control
 * session that lasts as long as the device connection. It is a *per-stream*
 * protocol: an RTSP session is opened (ANNOUNCE/SETUP), audio is streamed,
 * and the session is torn down. Because of that, `DeviceApi` hands you this
 * object without opening anything — you decide when a stream begins and ends.
 *
 * Two usage styles are offered:
 * - `stream()` — fire-and-forget convenience. Opens a session, streams the
 *   source to completion, and tears the session down automatically.
 * - `connect()` — returns a live {@link RaopClient} session you own, for
 *   streaming multiple sources, adjusting volume between tracks, or observing
 *   `playing`/`stopped` events. You must call `close()` on it when finished.
 */

import type { RAOPService } from "@/core/discovery/discovery-types.ts";
import { createLogger } from "@/logging/logging.ts";
import { RaopClient, type StreamOptions } from "./RaopClient.ts";
import type { AudioSource } from "./types.ts";

const logger = createLogger("bunatv:raop:api");

export class RaopApi {
  constructor(private readonly service: RAOPService) {}

  /**
   * Open a live RAOP streaming session.
   *
   * Connects to the receiver over RTSP and runs ANNOUNCE/SETUP, returning a
   * ready {@link RaopClient}. The caller owns the returned client and is
   * responsible for calling `close()` when finished.
   *
   * Use this when you want to stream more than one source over a single
   * session, change volume between tracks, or listen for playback events.
   *
   * @param options - Optional password for Digest-protected receivers.
   * @returns A connected {@link RaopClient} session.
   *
   * @example
   * ```ts
   * const session = await device.raop().connect();
   * session.on("stopped", () => console.log("done"));
   * try {
   *   await session.stream(firstTrack);
   *   await session.setVolumePercent(40);
   *   await session.stream(secondTrack);
   * } finally {
   *   await session.close();
   * }
   * ```
   */
  async connect(
    options: Pick<StreamOptions, "password"> = {}
  ): Promise<RaopClient> {
    logger.debug({ device: this.service.instanceName }, "Opening RAOP session");
    return RaopClient.create(this.service, options);
  }

  /**
   * Stream a single audio source end-to-end.
   *
   * Convenience wrapper that opens a session, streams the source to
   * completion (or until `error`), and always tears the session down — even
   * if streaming throws. Use {@link RaopApi.connect} instead when you need to
   * keep a session open across multiple sources.
   *
   * @param source  - PCM audio provider.
   * @param options - Metadata, initial volume, and/or password.
   *
   * @example
   * ```ts
   * await device.raop().stream(mySource, { volume: 50 });
   * ```
   */
  async stream(
    source: AudioSource,
    options: StreamOptions = {}
  ): Promise<void> {
    const client = await this.connect({ password: options.password });
    try {
      await client.stream(source, options);
    } finally {
      await client.close();
    }
  }
}
