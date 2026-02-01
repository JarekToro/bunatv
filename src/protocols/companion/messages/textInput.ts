import {
  type CompanionCommand,
  type CompanionOpackMessage,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  type CompanionEventOpackMessage,
  createCompanionCommand,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";
import { parse as parsePlist } from "@plist/plist";

export interface TextInputStartRequest extends CompanionRequestOpackMessage {
  _i: "_tiStart";
  _c: {};
}

export interface TextInputStartResponseContent {
  _tiD?: Uint8Array;
}

export interface TextInputStartResponse extends CompanionResponseOpackMessage {
  _i: "_tiStart";
  _c: TextInputStartResponseContent;
}

export interface TextInputStopRequest extends CompanionRequestOpackMessage {
  _i: "_tiStop";
  _c: {};
}

export interface TextInputStopResponse extends CompanionResponseOpackMessage {
  _i: "_tiStop";
  _c: {};
}

export interface TextInputStartedEventContent {
  _tiV: number;
  _tiD: Uint8Array; // Plist data
}

/**
 * Decoded structure of the _tiD plist data
 */
export interface DecodedTextInputData {
  _tiDT?: string; // Document text
  _tiSI?: number; // Selection index
  _tiSL?: number; // Selection length
  _tiKT?: number; // Keyboard type
  _tiAC?: boolean; // Autocorrection
  _tiAP?: boolean; // Autocapitalization
  _tiSR?: boolean; // Secure (password)
}

export interface TextInputStartedEvent extends CompanionEventOpackMessage {
  _i: "_tiStarted";
  _c: TextInputStartedEventContent;
}

export interface TextInputStoppedEventContent {
  _tiV: number;
}

export interface TextInputStoppedEvent extends CompanionEventOpackMessage {
  _i: "_tiStopped";
  _c: TextInputStoppedEventContent;
}

export interface ParsedTextInputStartedEvent {
  type: "text-input-started";
  version: number;
  documentText: string;
  cursorPosition: number;
  selectionLength: number;
  isSecure: boolean;
  keyboardType: number;
  autoCorrection: boolean;
  autoCapitalization: boolean;
  rawData: DecodedTextInputData;
  raw: TextInputStartedEvent;
}

export interface ParsedTextInputStoppedEvent {
  type: "text-input-stopped";
  version: number;
  raw: TextInputStoppedEvent;
}

export function parseTextInputStartedEvent(
  message: TextInputStartedEvent
): ParsedTextInputStartedEvent {
  const textData = parseTextInputPlist(message._c._tiD);
  return {
    type: "text-input-started",
    version: message._c._tiV,
    documentText: textData._tiDT || "",
    cursorPosition: textData._tiSI || 0,
    selectionLength: textData._tiSL || 0,
    isSecure: textData._tiSR || false,
    keyboardType: textData._tiKT || 0,
    autoCorrection: textData._tiAC || false,
    autoCapitalization: textData._tiAP || false,
    rawData: textData,
    raw: message,
  };
}

export function parseTextInputStoppedEvent(
  message: TextInputStoppedEvent
): ParsedTextInputStoppedEvent {
  return {
    type: "text-input-stopped",
    version: message._c._tiV,
    raw: message,
  };
}

function parseTextInputPlist(buffer: Uint8Array): DecodedTextInputData {
  try {
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    return parsePlist(arrayBuffer as ArrayBuffer) as DecodedTextInputData;
  } catch (error) {
    console.error("Failed to parse text input plist:", error);
    return {};
  }
}

/**
 * Factory function for creating TextInputStart commands
 */
export function createTextInputStartCommand(): CompanionCommand<
  TextInputStartRequest,
  TextInputStartResponse,
  Uint8Array | undefined
> {
  return createCompanionCommand({
    identifier: "_tiStart",
    name: "TextInputStart",
    buildContent: () => ({}),
    parse: (response) => response._c._tiD,
  });
}

/**
 * Factory function for creating TextInputStop commands
 */
export function createTextInputStopCommand(): CompanionCommand<
  TextInputStopRequest,
  TextInputStopResponse,
  void
> {
  return createCompanionCommand({
    identifier: "_tiStop",
    name: "TextInputStop",
    buildContent: () => ({}),
    parse: () => undefined,
  });
}

export interface ParsedTextInputStartResponse {
  type: "text-input-start-response";
  rawData: DecodedTextInputData;
  raw: TextInputStartResponse;
}

export function parseTextInputStartResponse(
  message: TextInputStartResponse
): ParsedTextInputStartResponse {
  const textData = message._c._tiD ? parseTextInputPlist(message._c._tiD) : {};
  return {
    type: "text-input-start-response",
    rawData: textData,
    raw: message,
  };
}
