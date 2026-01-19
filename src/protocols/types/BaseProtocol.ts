// ============================================================================
// Generic Protocol Orchestrator Interface
// ============================================================================

// Minimal protocol interface
import type { ConnectionOptions } from '@/cli/core/protocol-manager.ts'
import { EventEmitter } from 'eventemitter3'

/**
 * Generic command interface
 */
export interface Command<TRequest = unknown, TResponse = unknown, TOutput = unknown> {
  readonly name: string
  build(): TRequest
  parse(response: TResponse): TOutput
}

export type CommandRequestOf<C> = C extends Command<infer Req, any, any> ? Req : never
export type CommandResponseOf<C> = C extends Command<any, infer Res, any> ? Res : never
export type CommandOutputOf<C> = C extends Command<any, any, infer Out> ? Out : never

export enum ProtocolState {
  /** Not connected */
  Idle = 'idle',
  /** Connecting transport */
  Connecting = 'connecting',
  /** Transport connected, authenticating */
  Authenticating = 'authenticating',
  /** Authenticated, establishing session */
  EstablishingSession = 'establishing-session',
  /** Ready for commands */
  Ready = 'ready',
  /** Connection lost, attempting recovery */
  Recovering = 'recovering',
  /** Fatal error occurred */
  Failed = 'failed',
  /** Disconnecting */
  Disconnecting = 'disconnecting',
}

/**
 * Base credentials interface
 */
export interface BaseCredentials {
  [key: string]: unknown
}

/**
 * Generic credential store
 */
export interface CredentialStore<TCredentials> {
  save(identifier: string, credentials: TCredentials): Promise<void>
  load(identifier: string): Promise<TCredentials | undefined>
  delete(identifier: string): Promise<void>
}

export interface ProtocolEvents {
  // Connection lifecycle
  connecting: () => void
  connected: () => void
  disconnected: (reason?: string) => void
  ready: () => void
  // State transitions
  'state-changed': (state: ProtocolState, previous: ProtocolState) => void
  // Error handling
  error: (error: Error, context?: string) => void
}

export interface Protocol<T extends ProtocolEvents> extends EventEmitter<T> {
  readonly state: ProtocolState
  readonly isReady: boolean

  connect(options?: ConnectionOptions): Promise<void>
  disconnect(reason?: string): Promise<void>
}
