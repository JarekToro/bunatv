import {
  type CompanionOpackMessage,
  type CompanionResponseOpackMessage,
  type CompanionRequestOpackMessage,
  type SimpleCompanionCommand,
  createSimpleCompanionCommand,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";

interface TouchStartRequest extends CompanionRequestOpackMessage {
  _i: "_touchStart";
  _c: {};
}

interface TouchStartResponse extends CompanionResponseOpackMessage {
  _i: "_touchStart";
  _c: {};
}

interface TouchStopRequest extends CompanionRequestOpackMessage {
  _i: "_touchStop";
  _c: {};
}

interface TouchStopResponse extends CompanionResponseOpackMessage {
  _i: "_touchStop";
  _c: {};
}

/**
 * Factory function for creating TouchStart commands
 */
export function createTouchStartCommand(): SimpleCompanionCommand<"_touchStart"> {
  return createSimpleCompanionCommand("_touchStart", "TouchStart");
}

/**
 * Factory function for creating TouchStop commands
 */
export function createTouchStopCommand(): SimpleCompanionCommand<"_touchStop"> {
  return createSimpleCompanionCommand("_touchStop", "TouchStop");
}
