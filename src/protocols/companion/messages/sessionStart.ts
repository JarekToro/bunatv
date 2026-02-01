import {
  type CompanionCommand,
  type CompanionOpackMessage,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  createCompanionCommand,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";

export interface SessionStartRequestContent {
  _srvT: string;
  _sid: number;
}

export interface SessionStartRequest extends CompanionRequestOpackMessage {
  _i: "_sessionStart";
  _c: SessionStartRequestContent;
}

export interface SessionStartResponseContent {
  _sid: number;
}

export interface SessionStartResponse extends CompanionResponseOpackMessage {
  _i: "_sessionStart";
  _c: SessionStartResponseContent;
}

export function createSessionStartCommand(
  serviceType: string,
  sessionId: number
): CompanionCommand<SessionStartRequest, SessionStartResponse, number> {
  return createCompanionCommand({
    identifier: "_sessionStart",
    name: `SessionStart:${serviceType}:${sessionId}`,
    buildContent: () => ({
      _srvT: serviceType,
      _sid: sessionId,
    }),
    parse: (response) => response._c._sid,
  });
}

export interface ParsedSessionStartEvent {
  type: "session-start";
  serverSessionId: number;
  raw: SessionStartResponse;
}

export function parseSessionStartEvent(
  message: SessionStartResponse
): ParsedSessionStartEvent {
  return {
    type: "session-start",
    serverSessionId: message._c._sid,
    raw: message,
  };
}
