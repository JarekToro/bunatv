import { type CompanionOpackMessage } from './CompanionOpackMessage.ts'
import {
  type MediaControlEvent,
  type ParsedMediaControlEvent,
  parseMediaControlEvent,
} from './mediaControl.ts'
import {
  type SystemStatusEvent,
  type ParsedSystemStatusEvent,
  parseSystemStatusEvent,
} from './systemStatus.ts'
import {
  type TextInputStartedEvent,
  type TextInputStoppedEvent,
  type ParsedTextInputStartedEvent,
  type ParsedTextInputStoppedEvent,
  type ParsedTextInputStartResponse,
  parseTextInputStartedEvent,
  parseTextInputStoppedEvent,
} from './textInput.ts'
import { type HidTouchEvent, type ParsedHidTouchEvent, parseHidTouchEvent } from './hidTouch.ts'

export type ParsedCompanionEvent =
  | ParsedMediaControlEvent
  | ParsedSystemStatusEvent
  | ParsedTextInputStartedEvent
  | ParsedTextInputStoppedEvent
  | ParsedHidTouchEvent
  | ParsedTextInputStartResponse
  | {
      type: 'error'
      message: string
      code: number
      domain: string
      raw: CompanionOpackMessage
    }
  | {
      type: 'unknown'
      messageId: string
      content: any
      raw: CompanionOpackMessage
    }

const processors = {
  _iMC: (message: CompanionOpackMessage) => parseMediaControlEvent(message as MediaControlEvent),
  SystemStatus: (message: CompanionOpackMessage) =>
    parseSystemStatusEvent(message as SystemStatusEvent),
  TVSystemStatus: (message: CompanionOpackMessage) =>
    parseSystemStatusEvent(message as SystemStatusEvent),
  _tiStarted: (message: CompanionOpackMessage) =>
    parseTextInputStartedEvent(message as TextInputStartedEvent),
  _tiStopped: (message: CompanionOpackMessage) =>
    parseTextInputStoppedEvent(message as TextInputStoppedEvent),
  _hidT: (message: CompanionOpackMessage) => parseHidTouchEvent(message as HidTouchEvent),
} as const

export class CompanionEventMessageParser {
  parse(message: CompanionOpackMessage): ParsedCompanionEvent | null {
    // Error responses
    if (message._em || message._ec) {
      return this.parseError(message)
    }

    const processor = processors[message._i as keyof typeof processors]
    if (processor) {
      try {
        return processor(message)
      } catch (error) {
        console.error('Failed to parse message:', error, message)
        return this.parseUnknown(message)
      }
    }

    // Fallback for unknown types or if _t is missing
    return this.parseUnknown(message)
  }

  private parseError(message: CompanionOpackMessage) {
    return {
      type: 'error' as const,
      message: message._em || 'Unknown Error',
      code: message._ec || 0,
      domain: message._ed || 'unknown',
      raw: message,
    }
  }

  private parseUnknown(message: CompanionOpackMessage) {
    return {
      type: 'unknown' as const,
      messageId: message._i,
      content: message._c,
      raw: message,
    }
  }
}
