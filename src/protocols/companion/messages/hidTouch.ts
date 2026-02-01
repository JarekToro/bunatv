import { type CompanionEventOpackMessage } from "@/protocols/companion/messages/CompanionOpackMessage.ts";

export enum TouchAction {
  Press = 1,
  Hold = 3,
  Release = 4,
  Click = 5,
}

export interface HidTouchEventContent {
  _ns: number;
  _tFg: number;
  _cx: number;
  _cy: number;
  _tPh: TouchAction;
}

export interface HidTouchEvent extends CompanionEventOpackMessage {
  _i: "_hidT";
  _c: HidTouchEventContent;
}

export interface ParsedHidTouchEvent {
  type: "touch";
  timestamp: number;
  fingerId: number;
  x: number;
  y: number;
  phase: number;
  phaseName: string;
  raw: HidTouchEvent;
}

export function parseHidTouchEvent(
  message: HidTouchEvent
): ParsedHidTouchEvent {
  return {
    type: "touch",
    timestamp: message._c._ns,
    fingerId: message._c._tFg,
    x: message._c._cx,
    y: message._c._cy,
    phase: message._c._tPh,
    phaseName: getTouchPhaseName(message._c._tPh),
    raw: message,
  };
}

function getTouchPhaseName(phase: number): string {
  const phases: Record<number, string> = {
    1: "Press",
    3: "Hold",
    4: "Release",
    5: "SingleTap",
  };
  return phases[phase] || "Unknown";
}
