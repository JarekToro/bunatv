import {
  MessageType,
  type CompanionCommand,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  type EmptyResponse,
  type SimpleCompanionCommand,
  createCompanionCommand,
  createSimpleCompanionCommand,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";
import { DeviceState } from "@/protocols/types/DeviceState.ts";

/** Wire-format attention state values from the Companion protocol */
enum AttentionStateWire {
  Unknown = 0,
  Asleep = 1,
  Screensaver = 2,
  Awake = 3,
  Idle = 4,
}

function mapAttentionWireToDeviceState(wire: number): DeviceState {
  switch (wire) {
    case AttentionStateWire.Asleep:
      return DeviceState.Asleep;
    case AttentionStateWire.Screensaver:
      return DeviceState.Screensaver;
    case AttentionStateWire.Awake:
      return DeviceState.Awake;
    case AttentionStateWire.Idle:
      return DeviceState.Idle;
    default:
      return DeviceState.Unknown;
  }
}

export interface FetchAttentionStateRequest
  extends CompanionRequestOpackMessage {
  _i: "FetchAttentionState";
  _c: {};
}

export interface FetchAttentionStateResponseContent {
  state: number;
}

export interface FetchAttentionStateResponse
  extends CompanionResponseOpackMessage {
  _i: "FetchAttentionState";
  _c: FetchAttentionStateResponseContent;
}

// Factory function instead of class
export function createFetchAttentionStateCommand(): CompanionCommand<
  FetchAttentionStateRequest,
  FetchAttentionStateResponse,
  DeviceState
> {
  return createCompanionCommand({
    identifier: "FetchAttentionState",
    name: "FetchAttentionState",
    buildContent: () => ({}),
    parse: (response) => {
      return mapAttentionWireToDeviceState(response._c.state);
    },
  });
}
