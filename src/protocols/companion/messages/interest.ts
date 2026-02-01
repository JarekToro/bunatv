import {
  type CompanionEvent,
  type CompanionEventOpackMessage,
  createCompanionEvent,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";

export enum CompanionEventTypes {
  MediaControl = "_iMC",
  SystemStatus = "SystemStatus",
  TVSystemStatus = "TVSystemStatus",
  TextInputStarted = "_tiStarted",
  TextInputStopped = "_tiStopped",
  TextInputStart = "_tiStart",
  Interest = "_interest",
}

interface InterestEventContent {
  _regEvents?: CompanionEventTypes[];
  _deregEvents?: CompanionEventTypes[];
}

interface InterestEventMessage extends CompanionEventOpackMessage {
  _i: "_interest";
  _c: InterestEventContent;
}

/**
 * Factory function for creating Interest events
 */
export function createInterestEvent(
  options: {
    register?: CompanionEventTypes[];
    deregister?: CompanionEventTypes[];
  } = {}
): CompanionEvent<InterestEventMessage> {
  return createCompanionEvent({
    identifier: "_interest",
    name: "InterestEvent",
    buildContent: () => ({
      ...(options.register && { _regEvents: options.register }),
      ...(options.deregister && { _deregEvents: options.deregister }),
    }),
  });
}
