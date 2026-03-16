import {
  type CompanionEventOpackMessage,
  createCompanionEvent,
  MessageType,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";
import { DeviceState } from "@/protocols/types/DeviceState.ts";

export enum SystemState {
  Asleep = 0x01,
  Screensaver = 0x02,
  Awake = 0x03,
  Idle = 0x04,
}
export function getSystemStateName(state: SystemState): string {
  const stateNames: Record<SystemState, string> = {
    [SystemState.Asleep]: "Asleep",
    [SystemState.Screensaver]: "Screensaver",
    [SystemState.Awake]: "Awake",
    [SystemState.Idle]: "Idle",
  };
  return stateNames[state] || "Unknown";
}
export interface SystemStatusContent {
  state: SystemState;
}

export interface SystemStatusEvent extends CompanionEventOpackMessage {
  _i: "SystemStatus" | "TVSystemStatus";
  _c: SystemStatusContent;
}

export const createSystemStatusEvent = createCompanionEvent<SystemStatusEvent>({
  identifier: "SystemStatus",
  name: "SystemStatus",
  buildContent: () => ({ state: SystemState.Awake }), // Default placeholder
});

export interface ParsedSystemStatusEvent {
  type: "system-status";
  state: SystemState;
  raw: SystemStatusEvent;
}

export function parseSystemStatusEvent(
  message: SystemStatusEvent
): ParsedSystemStatusEvent {
  return {
    type: "system-status",
    state: message._c.state,
    raw: message,
  };
}

export function mapSystemStateToDeviceState(state: SystemState): DeviceState {
  switch (state) {
    case SystemState.Asleep:
      return DeviceState.Asleep;
    case SystemState.Screensaver:
      return DeviceState.Screensaver;
    case SystemState.Awake:
      return DeviceState.Awake;
    case SystemState.Idle:
      return DeviceState.Idle;
    default:
      return DeviceState.Unknown;
  }
}
