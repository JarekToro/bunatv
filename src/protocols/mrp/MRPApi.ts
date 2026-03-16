/**
 * MRPApi - Unified entry point for all MRP protocol functionality
 *
 * Composes MRPRemote (control) and MRPPlayerState (now-playing state)
 * into a single API with lifecycle management.
 */

import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { MRPRemote } from "@/protocols/mrp/remote/MRPRemote.ts";
import { MRPPlayerState } from "@/protocols/mrp/MRPPlayerState.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:mrp:api");

/**
 * Unified API for controlling an Apple TV via MRP protocol.
 *
 * Composes:
 * - `remote` — button/HID/navigation + sub-controllers (playback, audio, touch, power)
 * - `playerState` — now-playing state, queue, metadata, artwork
 *
 * Events live on the sub-controllers directly:
 * - `api.remote.power.on("powerStateChanged", ...)`
 * - `api.remote.audio.on("volumeChanged", ...)`
 *
 * @example
 * ```ts
 * const api = new MRPApi(protocol);
 *
 * // Control via sub-objects
 * await api.remote.pressHome();
 * await api.remote.playback.play();
 * api.remote.audio.setVolume(deviceUID, 0.5);
 * await api.remote.touch.swipeUp();
 * await api.remote.power.turnOn();
 *
 * // Player state
 * const client = api.playerState.activeClient;
 *
 * // Listen on sub-controllers directly
 * api.remote.power.on("powerStateChanged", (old, next) => { ... });
 * api.remote.audio.on("volumeChanged", (uid, vol) => { ... });
 *
 * // Cleanup
 * api.disconnect();
 * ```
 */
export class MRPApi {
  /** Remote control facade (buttons, HID, playback, audio, touch, power) */
  readonly remote: MRPRemote;

  /** Now-playing state manager (clients, players, queue, metadata) */
  readonly playerState: MRPPlayerState;

  constructor(private readonly protocol: MRPProtocol) {
    this.remote = new MRPRemote(protocol);
    this.playerState = new MRPPlayerState(protocol);

    logger.debug("MRPApi initialized");
  }

  /**
   * Post-connection initialization.
   *
   * Reserved for future subscription setup (e.g., registering for
   * specific message types, sending handshake messages).
   */
  initialize(): void {
    logger.debug("MRPApi initialize (no-op for now)");
  }

  /**
   * Disconnect and clean up all resources.
   * Removes event listeners from sub-controllers that are EventEmitters.
   */
  disconnect(): void {
    logger.debug("MRPApi disconnecting");
    this.remote.power.removeAllListeners();
    this.remote.audio.removeAllListeners();
  }
}
