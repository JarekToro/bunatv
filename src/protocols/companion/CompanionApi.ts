/**
 * CompanionApi - Unified entry point for Apple TV control via Companion protocol
 *
 * Composes sub-controllers for playback, audio, power, input, text input, and apps
 * into a single API with lifecycle management.
 */

import { createLogger } from "@/logging/logging.ts";
import type { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import { CompanionEventTypes } from "@/protocols/companion/messages/interest.ts";
import { ProtocolState } from "@/protocols/types/BaseProtocol.ts";
import { createSystemInfoCommand } from "@/protocols/companion/messages/systemInfo.ts";
import type { ClientDeviceInfo } from "@/core/client-identity.ts";
import { createTextInputStartCommand } from "@/protocols/companion/messages/textInput.ts";
import { createTouchStartCommand } from "@/protocols/companion/messages/touchSession.ts";

import { CompanionPlayback } from "@/protocols/companion/controllers/CompanionPlayback.ts";
import { CompanionAudio } from "@/protocols/companion/controllers/CompanionAudio.ts";
import { CompanionPower } from "@/protocols/companion/controllers/CompanionPower.ts";
import { CompanionInput } from "@/protocols/companion/controllers/CompanionInput.ts";
import { CompanionTextInput } from "@/protocols/companion/controllers/CompanionTextInput.ts";
import { CompanionApps } from "@/protocols/companion/controllers/CompanionApps.ts";

const logger = createLogger("bunatv:companion:api");

/**
 * Unified API for controlling an Apple TV via Companion protocol.
 *
 * Events live on the sub-controllers directly:
 * - `api.power.on("stateChanged", ...)`
 * - `api.audio.on("volumeChanged", ...)`
 * - `api.input.on("touch", ...)`
 * - `api.textInput.on("started", ...)`
 *
 * @example
 * ```ts
 * const api = new CompanionApi(protocol, deviceInfo);
 *
 * // Playback
 * await api.playback.play();
 * await api.playback.nextTrack();
 *
 * // Audio
 * await api.audio.setVolume(0.5);
 * await api.audio.toggleMute();
 *
 * // Power
 * await api.power.sleep();
 * await api.power.wake();
 *
 * // Input
 * await api.input.pressButton(HidCommandType.Home, InputAction.Single);
 *
 * // Apps
 * await api.apps.launch("com.apple.TVMusic");
 *
 * // Cleanup
 * await api.disconnect();
 * ```
 */
export class CompanionApi {
  readonly playback: CompanionPlayback;
  readonly audio: CompanionAudio;
  readonly power: CompanionPower;
  readonly input: CompanionInput;
  readonly textInput: CompanionTextInput;
  readonly apps: CompanionApps;

  constructor(
    private readonly protocol: CompanionProtocol,
    private readonly device: ClientDeviceInfo
  ) {
    this.playback = new CompanionPlayback(protocol);
    this.audio = new CompanionAudio(protocol);
    this.power = new CompanionPower(protocol);
    this.input = new CompanionInput(protocol);
    this.textInput = new CompanionTextInput(protocol);
    this.apps = new CompanionApps(protocol);

    this._setupLifecycle();
  }

  private _setupLifecycle() {
    if (this.protocol.isReady) {
      logger.debug("Protocol is ready, initializing");
      this.initialize();
    } else if (this.protocol.state === ProtocolState.Connecting) {
      logger.debug("Protocol is connecting, waiting for connected event");
      this.protocol.once("connected", () => {
        logger.debug("Protocol is ready, initializing");
        this.initialize();
      });
    }
  }

  private async initialize() {
    try {
      logger.debug("Initializing Companion API");
      await this.systemInfo();

      await this.protocol.sendCommand(createTouchStartCommand());
      await this.protocol.sendCommand(createTextInputStartCommand());
      await this.audio.getVolume();

      await this.protocol.subscribeToInterest([
        CompanionEventTypes.MediaControl,
      ]);
      await this.protocol.subscribeToInterest([
        CompanionEventTypes.SystemStatus,
      ]);
      await this.protocol.subscribeToInterest([
        CompanionEventTypes.TVSystemStatus,
      ]);
    } catch (error) {
      logger.error({ error }, "Failed to initialize Companion API");
    }
  }

  async systemInfo() {
    const clientId = this.protocol.getClientId();
    if (!clientId) {
      throw new Error(
        "clientid is missing from protocol, has it authenticated?"
      );
    }
    const resp = await this.protocol.sendCommand(
      createSystemInfoCommand({
        _i: this.device.rpId,
        _idsID: clientId,
        _pubID: this.device.deviceId,
        model: this.device.model,
        name: this.device.name,
      })
    );
    return resp;
  }

  /**
   * Clean up sub-controller event listeners without disconnecting the protocol.
   * Called by DeviceApi before protocol disconnect to prevent listener leaks.
   */
  cleanup(): void {
    logger.debug("Cleaning up CompanionApi sub-controllers");
    this.power.removeAllListeners();
    this.input.removeAllListeners();
    this.textInput.removeAllListeners();
    this.audio.removeAllListeners();
  }

  async disconnect(): Promise<void> {
    logger.info("Disposing CompanionApi resources");
    this.cleanup();
    await this.protocol.disconnect("CompanionApi disposed");
  }
}
