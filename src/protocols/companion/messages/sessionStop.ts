import {
  type CompanionCommand,
  type CompanionOpackMessage,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  createCompanionCommand,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";

export interface SessionStopRequestContent {
  _srvT: string;
  _sid: bigint; // Combined 64-bit session ID
}

export interface SessionStopRequest extends CompanionRequestOpackMessage {
  _i: "_sessionStop";
  _c: SessionStopRequestContent;
}

export interface SessionStopResponse extends CompanionResponseOpackMessage {
  _i: "_sessionStop";
  _c: {};
}

/**
 * Factory function for creating SessionStop commands
 */
export function createSessionStopCommand(
  serviceType: string,
  sessionId: bigint
): CompanionCommand<SessionStopRequest, SessionStopResponse, void> {
  return createCompanionCommand({
    identifier: "_sessionStop",
    name: `SessionStop:${serviceType}:${sessionId}`,
    buildContent: () => ({
      _srvT: serviceType,
      _sid: sessionId,
    }),
    parse: () => undefined,
  });
}
