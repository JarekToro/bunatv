import {
  type CompanionCommand,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  createCompanionCommand,
} from '@/protocols/companion/messages/CompanionOpackMessage.ts'

export enum HidCommandType {
  Up = 1,
  Down = 2,
  Left = 3,
  Right = 4,
  Menu = 5,
  Select = 6,
  Home = 7,
  VolumeUp = 8,
  VolumeDown = 9,
  Siri = 10,
  Screensaver = 11,
  Sleep = 12,
  Wake = 13,
  PlayPause = 14,
  ChannelIncrement = 15,
  ChannelDecrement = 16,
  Guide = 17,
  PageUp = 18, // Seems to be mute actually?
  PageDown = 19,
}

export enum HidCommandModifier {
  Down = 1,
  Up = 2,
}

export interface HidCommandRequestContent {
  _hBtS: HidCommandModifier
  _hidC: HidCommandType
}

export interface HidCommandRequest extends CompanionRequestOpackMessage {
  _i: '_hidC'
  _c: HidCommandRequestContent
}

export interface HidCommandResponse extends CompanionResponseOpackMessage {
  _i: '_hidC'
  _c: {}
}

export interface ParsedHidCommandResponse {
  type: 'hid-command-response'
  raw: HidCommandResponse
}

export function parseHidCommandResponse(message: HidCommandResponse): ParsedHidCommandResponse {
  return {
    type: 'hid-command-response',
    raw: message,
  }
}

export function createHidCommand(
  commandType: HidCommandType,
  modifier: HidCommandModifier
): CompanionCommand<HidCommandRequest, HidCommandResponse, void> {
  return createCompanionCommand({
    identifier: '_hidC',
    name: `HidCommand:${HidCommandType[commandType]}`,
    buildContent: () => ({
      _hBtS: modifier,
      _hidC: commandType,
    }),
    parse: () => undefined,
  })
}
