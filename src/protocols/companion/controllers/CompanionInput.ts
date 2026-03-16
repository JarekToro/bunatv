/**
 * CompanionInput - HID button and touch input for Apple TV via Companion protocol
 */

import { EventEmitter } from "eventemitter3";
import type { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import {
  createHidCommand,
  HidCommandModifier,
  type HidCommandType,
} from "@/protocols/companion/messages/hidCommand.ts";
import { InputAction } from "@/protocols/types/InputAction.ts";
import type { ParsedHidTouchEvent } from "@/protocols/companion/messages/hidTouch.ts";
import { sleep } from "@/core/utils/timing.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:companion:input");

export type CompanionInputEvents = {
  touch: (event: ParsedHidTouchEvent) => void;
};

export class CompanionInput extends EventEmitter<CompanionInputEvents> {
  private _lastTouch: ParsedHidTouchEvent | null = null;

  constructor(private readonly protocol: CompanionProtocol) {
    super();
    this._setupListeners();
  }

  get lastTouch(): ParsedHidTouchEvent | null {
    return this._lastTouch;
  }

  async pressButton(
    command: HidCommandType,
    action: InputAction,
    delay = 0.2
  ): Promise<void> {
    logger.debug({ command, action, delay }, "Pressing button");

    if (action === InputAction.Single) {
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Down)
      );
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Up)
      );
    } else if (action === InputAction.Hold) {
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Down)
      );
      await sleep(delay * 1000);
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Up)
      );
    } else if (action === InputAction.Double) {
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Down)
      );
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Up)
      );
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Down)
      );
      await this.protocol.sendCommand(
        createHidCommand(command, HidCommandModifier.Up)
      );
    }
  }

  private _setupListeners(): void {
    this.protocol.on("touch", (event) => {
      this._lastTouch = event;
      this.emit("touch", event);
    });
  }
}
