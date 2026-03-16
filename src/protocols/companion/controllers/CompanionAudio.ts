/**
 * CompanionAudio - Volume control for Apple TV via Companion protocol
 */

import { EventEmitter } from "eventemitter3";
import type { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import {
  createGetVolumeCommand,
  createSetVolumeCommand,
} from "@/protocols/companion/messages/mediaControl.ts";
import {
  createHidCommand,
  HidCommandType,
  HidCommandModifier,
} from "@/protocols/companion/messages/hidCommand.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:companion:audio");

export type CompanionAudioEvents = {
  volumeChanged: (volume: number) => void;
};

export class CompanionAudio extends EventEmitter<CompanionAudioEvents> {
  private _volume = 0;

  constructor(private readonly protocol: CompanionProtocol) {
    super();
  }

  get volume(): number {
    return this._volume;
  }

  async getVolume(): Promise<number> {
    logger.debug("Getting volume level");
    const volume = await this.protocol.sendCommand(createGetVolumeCommand());
    const changed = this._volume !== volume;
    this._volume = volume;
    if (changed) {
      this.emit("volumeChanged", volume);
    }
    logger.debug({ volume }, "Volume retrieved");
    return volume;
  }

  async setVolume(level: number): Promise<void> {
    if (level < 0 || level > 1) {
      throw new Error("Volume level must be between 0.0 and 1.0");
    }
    logger.debug({ level }, "Setting volume level");
    await this.protocol.sendCommand(createSetVolumeCommand({ _vol: level }));
  }

  async toggleMute(): Promise<void> {
    logger.debug("Toggling mute");
    await this.protocol.sendCommand(
      createHidCommand(HidCommandType.PageUp, HidCommandModifier.Down)
    );
    await this.protocol.sendCommand(
      createHidCommand(HidCommandType.PageUp, HidCommandModifier.Up)
    );
  }
}
