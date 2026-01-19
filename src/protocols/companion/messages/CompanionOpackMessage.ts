import type { Command } from '@/protocols/types/BaseProtocol.ts'

export type PlistBuffer = Uint8Array

// Message type constants from pyatv's MessageType enum
export enum MessageType {
  Event = 1,
  Request = 2,
  Response = 3,
}

export enum InputAction {
  Hold = 1,
  Single = 2,
  Double = 3,
}

/**
 * OPACK message structure for Companion protocol
 * Note: Does not extend BaseMessage due to different property names
 */
export interface CompanionOpackMessage {
  /** Message identifier */
  _i: string
  /** Message type (2=request, 3=response) */
  _t: MessageType
  /** Command content */
  _c: Record<string, any>
  /** Transaction ID */
  _x?: number
  /** Error message (if applicable) */
  _em?: string
  /** Error code (if applicable) */
  _ec?: number
  /** Error domain (if applicable) */
  _ed?: string
}

/**
 * OPACK message structure for Companion protocol
 * Note: Does not extend BaseMessage due to different property names
 */
export interface CompanionRequestOpackMessage extends CompanionOpackMessage {
  _t: MessageType.Request
}
export interface CompanionResponseOpackMessage extends CompanionOpackMessage {
  _t: MessageType.Response
}
export interface CompanionEventOpackMessage extends CompanionOpackMessage {
  _t: MessageType.Event
}

export type TrackableCompanionOpackMessage = Omit<CompanionOpackMessage, '_x'> & { _x: number }

export interface EmptyRequest<T extends string> extends CompanionRequestOpackMessage {
  _i: T
}
export interface EmptyResponse<T extends string> extends CompanionResponseOpackMessage {
  _i: T
}

export type SimpleCompanionCommand<T extends string> = CompanionCommand<
  EmptyRequest<T>,
  EmptyResponse<T>,
  void
>

export type CompanionCommand<
  Req extends CompanionRequestOpackMessage = CompanionRequestOpackMessage,
  Res extends CompanionResponseOpackMessage = CompanionResponseOpackMessage,
  O = unknown,
> = Command<Req, Res, O>

/**
 * Factory function for creating CompanionCommand instances with minimal boilerplate
 */
export function createCompanionCommand<
  Req extends CompanionRequestOpackMessage,
  Res extends CompanionResponseOpackMessage,
  O = unknown,
>(config: {
  /** Command identifier (maps to _i field) */
  identifier: string
  /** Human-readable name for the command */
  name: string
  /** Build the command content (_c field) */
  buildContent: () => Req['_c']
  /** Parse the response */
  parse: (response: Res) => O
}): CompanionCommand<Req, Res, O> {
  return {
    name: config.name,
    build: () =>
      ({
        _t: MessageType.Request,
        _i: config.identifier,
        _c: config.buildContent(),
      }) as Req,
    parse: config.parse,
  }
}

/**
 * Factory for empty commands with no content
 */
export function createSimpleCompanionCommand<T extends string>(
  identifier: T,
  name?: string
): SimpleCompanionCommand<T> {
  return createCompanionCommand<EmptyRequest<T>, EmptyResponse<T>, void>({
    identifier,
    name: name ?? identifier,
    buildContent: () => ({}),
    parse: () => undefined,
  })
}

/**
 * Event message interface (different from Command)
 */
export interface CompanionEvent<
  TMessage extends CompanionEventOpackMessage = CompanionEventOpackMessage,
> {
  readonly name: string
  build(): TMessage
}

/**
 * Factory function for creating CompanionEvent instances
 */
export function createCompanionEvent<T extends CompanionEventOpackMessage>(config: {
  /** Event identifier (maps to _i field) */
  identifier: string
  /** Human-readable name for the event */
  name: string
  /** Build the event content (_c field) */
  buildContent: () => T['_c']
}): CompanionEvent<T> {
  return {
    name: config.name,
    build: () =>
      ({
        _t: MessageType.Event,
        _i: config.identifier,
        _c: config.buildContent(),
      }) as T,
  }
}
