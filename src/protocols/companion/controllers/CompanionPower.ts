/**
 * CompanionPower - Power/attention state management for Apple TV via Companion protocol
 */

import { EventEmitter } from "eventemitter3";
import type { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import { createFetchAttentionStateCommand } from "@/protocols/companion/messages/systemPower.ts";
import { DeviceState } from "@/protocols/types/DeviceState.ts";
import { mapSystemStateToDeviceState } from "@/protocols/companion/messages/systemStatus.ts";
import { createLogger } from "@/logging/logging.ts";
import {
  createHidCommand,
  HidCommandModifier,
  HidCommandType,
} from "@/protocols/companion/messages/hidCommand.ts";
import { sleep } from "@/core/utils/timing";

const logger = createLogger("bunatv:companion:power");

export type CompanionPowerEvents = {
  stateChanged: (state: DeviceState) => void;
};

export class CompanionPower extends EventEmitter<CompanionPowerEvents> {
  private _attentionState: DeviceState = DeviceState.Unknown;

  constructor(private readonly protocol: CompanionProtocol) {
    super();
    this._setupListeners();
  }

  get attentionState(): DeviceState {
    return this._attentionState;
  }

  async getDeviceState(): Promise<DeviceState> {
    logger.debug("Getting attention state");
    const state = await this.protocol.sendCommand(
      createFetchAttentionStateCommand()
    );
    this._updateState(state);
    logger.debug({ state }, "Attention state retrieved");
    return state;
  }

  async sleep(): Promise<void> {
    logger.debug("Sending system sleep command");
    await this.protocol.sendCommand(
      createHidCommand(HidCommandType.Sleep, HidCommandModifier.Down)
    );
    await sleep(100);
    await this.protocol.sendCommand(
      createHidCommand(HidCommandType.Sleep, HidCommandModifier.Up)
    );
  }

  async wake(): Promise<void> {
    logger.debug("Sending system wake command");
    await this.protocol.sendCommand(
      createHidCommand(HidCommandType.Wake, HidCommandModifier.Down)
    );
    await sleep(100);
    await this.protocol.sendCommand(
      createHidCommand(HidCommandType.Wake, HidCommandModifier.Up)
    );
  }

  private _setupListeners(): void {
    this.protocol.on("system-status", (event) => {
      this._updateState(mapSystemStateToDeviceState(event.state));
    });
  }

  private _updateState(state: DeviceState): void {
    if (this._attentionState !== state) {
      this._attentionState = state;
      this.emit("stateChanged", state);
    }
  }
}
