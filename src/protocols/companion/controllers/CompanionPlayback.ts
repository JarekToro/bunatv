/**
 * CompanionPlayback - Media playback control for Apple TV via Companion protocol
 */

import type { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import {
  createPlayCommand,
  createPauseCommand,
  createNextTrackCommand,
  createPreviousTrackCommand,
  createSkipByCommand,
  createFastForwardBeginCommand,
  createFastForwardEndCommand,
  createRewindBeginCommand,
  createRewindEndCommand,
} from "@/protocols/companion/messages/mediaControl.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:companion:playback");

export class CompanionPlayback {
  constructor(private readonly protocol: CompanionProtocol) {}

  async play(): Promise<void> {
    logger.debug("Sending play command");
    await this.protocol.sendCommand(createPlayCommand());
  }

  async pause(): Promise<void> {
    logger.debug("Sending pause command");
    await this.protocol.sendCommand(createPauseCommand());
  }

  async nextTrack(): Promise<void> {
    logger.debug("Sending next track command");
    await this.protocol.sendCommand(createNextTrackCommand());
  }

  async previousTrack(): Promise<void> {
    logger.debug("Sending previous track command");
    await this.protocol.sendCommand(createPreviousTrackCommand());
  }

  async skipBy(seconds: number): Promise<void> {
    logger.debug({ seconds }, "Sending skip by command");
    await this.protocol.sendCommand(createSkipByCommand({ _skpS: seconds }));
  }

  async fastForwardBegin(): Promise<void> {
    logger.debug("Starting fast forward");
    await this.protocol.sendCommand(createFastForwardBeginCommand());
  }

  async fastForwardEnd(): Promise<void> {
    logger.debug("Ending fast forward");
    await this.protocol.sendCommand(createFastForwardEndCommand());
  }

  async rewindBegin(): Promise<void> {
    logger.debug("Starting rewind");
    await this.protocol.sendCommand(createRewindBeginCommand());
  }

  async rewindEnd(): Promise<void> {
    logger.debug("Ending rewind");
    await this.protocol.sendCommand(createRewindEndCommand());
  }
}
