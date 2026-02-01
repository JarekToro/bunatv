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

export enum AttentionState {
  Unknown = 0,
  Asleep = 1,
  Screensaver = 2,
  Awake = 3,
  Idle = 4,
}

export interface FetchAttentionStateRequest
  extends CompanionRequestOpackMessage {
  _i: "FetchAttentionState";
  _c: {};
}

export interface FetchAttentionStateResponseContent {
  state: AttentionState;
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
  AttentionState
> {
  return createCompanionCommand({
    identifier: "FetchAttentionState",
    name: "FetchAttentionState",
    buildContent: () => ({}),
    parse: (response) => {
      return response._c.state;
    },
  });
}

// Simple factory function for empty command
export function createSystemSleepCommand(): SimpleCompanionCommand<"_systemSleep"> {
  return createSimpleCompanionCommand("_systemSleep", "SystemSleep");
}

// Simple factory function for empty command
export function createSystemWakeCommand(): SimpleCompanionCommand<"_systemWake"> {
  return createSimpleCompanionCommand("_systemWake", "SystemWake");
}

// Usage:
// const fetchState = createFetchAttentionStateCommand()
// const sleep = createSystemSleepCommand()
// const wake = createSystemWakeCommand()
