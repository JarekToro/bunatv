import { EventEmitter } from 'eventemitter3'

import type { Socket } from 'bun'
import { createLogger } from '@/logging/logging.ts'

/**
 * Transport connection states
 */
export enum TransportState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnecting = 'disconnecting',
  Error = 'error',
}

/**
 * Transport configuration options
 */
export interface TransportOptions {
  /** Connection timeout in milliseconds */
  timeout?: number
  /** Enable auto-reconnection */
  autoReconnect?: boolean
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number
  /** Reconnection delay in milliseconds */
  reconnectDelay?: number
}
/**
 * Transport events
 */
export interface TransportEvents {
  data: (data: Buffer) => void
  error: (error: Error) => void
  'state-changed': (state: TransportState, previous: TransportState) => void
  drain: () => void
}

const logger = createLogger("bunatv:net:tcp-transport");
export class BunTCPTransport extends EventEmitter<TransportEvents> {
  private socket?: Socket
  private _state: TransportState = TransportState.Disconnected
  private reconnectAttempts: number = 0
  private options: Required<TransportOptions>
  private reconnectTimer?: NodeJS.Timeout
  private host?: string
  private port?: number

  constructor(defaultOptions?: TransportOptions) {
    super()
    this.options = {
      timeout: 10000,
      autoReconnect: false,
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      ...defaultOptions,
    }
  }

  get state(): TransportState {
    return this._state
  }
  get isConnected(): boolean {
    return this._state === TransportState.Connected
  }

  async connect(host: string, port: number, options?: TransportOptions): Promise<void> {
    if (this._state === TransportState.Connected || this._state === TransportState.Connecting) {
      logger.warn({ state: this._state }, `Cannot connect: already ${this._state}`)
      throw new Error(`Cannot connect: already ${this._state}`)
    }

    logger.info({ host, port }, 'Connecting to TCP endpoint')
    this.host = host
    this.port = port
    if (options) {
      this.options = { ...this.options, ...options }
    }

    this.setState(TransportState.Connecting)

    try {
      await this.establishConnection()
      logger.info({ host, port }, 'TCP connection established successfully')
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to establish TCP connection')
      this.setState(TransportState.Error)
      if (this.options.autoReconnect) {
        this.scheduleReconnect()
      }
      throw error
    }
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      let isResolved = false

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true
          this.setState(TransportState.Error)
          reject(new Error('Connection timeout'))
        }
      }, this.options.timeout)

      Bun.connect({
        hostname: this.host!,
        port: this.port!,
        socket: {
          data: (socket, buffer) => {
            logger.debug({ bytes: buffer.length }, 'Received data')
            this.emit('data', buffer)
          },
          open: socket => {
            isResolved = true
            clearTimeout(timeout)
            this.reconnectAttempts = 0
            this.socket = socket
            logger.info(
              { remoteAddress: socket.remoteAddress, localPort: socket.localPort },
              'TCP socket opened'
            )
            this.setState(TransportState.Connected)
            resolve()
          },
          close: () => {
            logger.info('TCP socket closed by remote')
            this.handleDisconnection('Remote closed connection')
          },
          error: (socket, error) => {
            logger.error({ error }, 'TCP socket error')
            isResolved = true
            clearTimeout(timeout)
            this.setState(TransportState.Error)
            this.emit('error', error)
            reject(error)
          },
          drain: () => {
            this.emit('drain')
          },
          timeout: () => {
            logger.warn('TCP socket timeout')
            this.handleDisconnection('Connection timeout')
          },
        },
      }).catch(reject)
    })
  }

  async disconnect(reason?: string): Promise<void> {
    if (this._state === TransportState.Disconnected) {
      logger.debug('Already disconnected, ignoring disconnect request')
      return
    }

    logger.info({ reason }, 'Disconnecting TCP transport')
    this.setState(TransportState.Disconnecting)
    this.clearTimers()

    if (this.socket) {
      this.socket.close()
      this.socket = undefined
    }

    this.setState(TransportState.Disconnected)
  }

  async send(data: Buffer): Promise<void> {
    if (!this.isConnected || !this.socket) {
      logger.error(
        { connected: this.isConnected, hasSocket: !!this.socket },
        'Cannot send: not connected'
      )
      throw new Error('Not connected')
    }

    logger.trace({ bytes: data.length }, 'Sending data')

    let offset = 0
    while (offset < data.length) {
      // Write only the remaining data starting from offset
      const bytesWritten = this.socket.write(
        data, // The full buffer
        offset, // Start from where we left off
        data.length - offset // Only write the remaining bytes
      )

      if (bytesWritten === -1) {
        throw new Error('Socket closed during write')
      }

      offset += bytesWritten // Move the offset forward

      // If there's still data left, wait for the socket to drain
      if (offset < data.length) {
        logger.debug(
          { written: bytesWritten, remaining: data.length - offset },
          'Backpressure detected, waiting to drain'
        )

        await new Promise<void>(resolve => this.once('drain', resolve))
      }
    }

    logger.trace({ bytes: data.length }, 'Data sent successfully')
  }

  setTimeout(timeout: number): void {
    this.options.timeout = timeout
  }

  private setState(state: TransportState): void {
    const previous = this._state
    this._state = state
    if (state !== previous) {
      this.emit('state-changed', state, previous)
    }
  }

  private handleDisconnection(reason: string): void {
    const wasConnected = this.isConnected
    logger.info({ reason, wasConnected }, 'Handling disconnection')
    this.setState(TransportState.Disconnected)
    this.clearTimers()
    this.socket = undefined

    if (
      wasConnected &&
      this.options.autoReconnect &&
      this.reconnectAttempts < this.options.maxReconnectAttempts
    ) {
      logger.debug(
        { attempts: this.reconnectAttempts, maxAttempts: this.options.maxReconnectAttempts },
        'Auto-reconnect enabled, scheduling'
      )
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    const delay = this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts)
    this.reconnectAttempts++

    logger.info({ delay, attempt: this.reconnectAttempts }, 'Scheduling reconnection')
    this.reconnectTimer = setTimeout(() => {
      logger.debug('Executing scheduled reconnection')
      this.connect(this.host!, this.port!).catch(error => {
        logger.error({ error }, 'Reconnection failed')
        this.emit('error', new Error(`Reconnection failed: ${error.message}`))
      })
    }, delay)
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }
}
