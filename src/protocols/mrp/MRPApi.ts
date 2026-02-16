/**
 * MRPApi - Unified entry point for all MRP protocol functionality
 *
 * Composes MRPRemote (control) and MRPPlayerState (now-playing state)
 * into a single cohesive API with unified event surface and lifecycle.
 */

import { EventEmitter } from "eventemitter3";
import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { MRPRemote } from "@/protocols/mrp/remote/MRPRemote.ts";
import { MRPPlayerState } from "@/protocols/mrp/MRPPlayerState.ts";
import {
  type PowerState,
  type MRPPowerEvents,
} from "@/protocols/mrp/remote/MRPPower.ts";
import type {
  OutputDevice,
  VolumeControlState,
  MRPAudioEvents,
} from "@/protocols/mrp/remote/MRPAudio.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:mrp:api");

// ============================================================================
// Events
// ============================================================================

type MRPApiEvents = {
  // Power events (forwarded from MRPPower)
  "power:stateChanged": MRPPowerEvents["powerStateChanged"];

  // Audio events (forwarded from MRPAudio)
  "audio:outputDevicesChanged": MRPAudioEvents["outputDevicesChanged"];
  "audio:activeDeviceChanged": MRPAudioEvents["activeDeviceChanged"];
  "audio:volumeChanged": MRPAudioEvents["volumeChanged"];
  "audio:volumeControlChanged": MRPAudioEvents["volumeControlChanged"];
  "audio:deviceVolumeCapabilitiesChanged": MRPAudioEvents["deviceVolumeCapabilitiesChanged"];
};

// ============================================================================
// MRPApi Class
// ============================================================================

/**
 * Unified API for controlling an Apple TV via MRP protocol.
 *
 * Composes:
 * - `remote` — button/HID/navigation + sub-controllers (playback, audio, touch, power)
 * - `playerState` — now-playing state, queue, metadata, artwork
 *
 * Provides a unified event surface that bubbles events from sub-controllers,
 * and lifecycle methods for setup/teardown.
 *
 * @example
 * ```ts
 * const api = new MRPApi(protocol);
 *
 * // Unified events
 * api.on("power:stateChanged", (oldState, newState) => {
 *   console.log(`Power: ${oldState} -> ${newState}`);
 * });
 * api.on("audio:volumeChanged", (uid, volume) => {
 *   console.log(`Volume on ${uid}: ${volume}`);
 * });
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
 * // Cleanup
 * api.disconnect();
 * ```
 */
export class MRPApi extends EventEmitter<MRPApiEvents> {
  /** Remote control facade (buttons, HID, playback, audio, touch, power) */
  readonly remote: MRPRemote;

  /** Now-playing state manager (clients, players, queue, metadata) */
  readonly playerState: MRPPlayerState;

  /** Bound listener references for cleanup */
  private _boundListeners: Array<{ remove: () => void }> = [];

  constructor(private readonly protocol: MRPProtocol) {
    super();

    this.remote = new MRPRemote(protocol);
    this.playerState = new MRPPlayerState(protocol);

    this._setupEventForwarding();

    logger.debug("MRPApi initialized");
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

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
   *
   * Removes all forwarded event listeners and clears this emitter.
   */
  disconnect(): void {
    logger.debug("MRPApi disconnecting — removing event forwarding");

    for (const listener of this._boundListeners) {
      listener.remove();
    }
    this._boundListeners = [];

    this.removeAllListeners();
  }

  // ==========================================================================
  // Event Forwarding
  // ==========================================================================

  private _setupEventForwarding(): void {
    // ── Power ──
    this._forward(this.remote.power, "powerStateChanged", "power:stateChanged");

    // ── Audio ──
    this._forward(
      this.remote.audio,
      "outputDevicesChanged",
      "audio:outputDevicesChanged"
    );
    this._forward(
      this.remote.audio,
      "activeDeviceChanged",
      "audio:activeDeviceChanged"
    );
    this._forward(this.remote.audio, "volumeChanged", "audio:volumeChanged");
    this._forward(
      this.remote.audio,
      "volumeControlChanged",
      "audio:volumeControlChanged"
    );
    this._forward(
      this.remote.audio,
      "deviceVolumeCapabilitiesChanged",
      "audio:deviceVolumeCapabilitiesChanged"
    );
  }

  /**
   * Forward an event from a source emitter to this MRPApi emitter.
   */
  private _forward<
    TSourceEvents extends EventEmitter.ValidEventTypes,
    TSourceEvent extends EventEmitter.EventNames<TSourceEvents>,
    TApiEvent extends EventEmitter.EventNames<MRPApiEvents>,
  >(
    source: EventEmitter<TSourceEvents>,
    sourceEvent: TSourceEvent,
    apiEvent: TApiEvent
  ): void {
    const handler = (
      ...args: Parameters<
        EventEmitter.EventListener<TSourceEvents, TSourceEvent>
      >
    ) => {
      this.emit(
        apiEvent,
        ...(args as Parameters<
          EventEmitter.EventListener<MRPApiEvents, TApiEvent>
        >)
      );
    };

    source.on(
      sourceEvent,
      handler as EventEmitter.EventListener<TSourceEvents, TSourceEvent>
    );

    this._boundListeners.push({
      remove: () =>
        source.off(
          sourceEvent,
          handler as EventEmitter.EventListener<TSourceEvents, TSourceEvent>
        ),
    });
  }
}
