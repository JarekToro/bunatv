import { EventEmitter } from 'eventemitter3'
import { createLogger } from '@/logging/logging'
import type { BunTCPTransport } from '@/protocols/shared/layers/BunTCPTransport.ts'
import type { ChaCha20EncryptionLayer } from '@/protocols/shared/layers/ChaCha20EncryptionLayer.ts'
import {
  BufferPool,
  StreamBuffer,
  BufferWriter,
  BunOptimizedUtils,
} from '@/core/encoding/buffer-utils.ts'
import { HapFrameLayer } from '@/protocols/airplay/layers/HapFrameLayer.ts'

export interface HttpResponse {
  statusCode: number
  statusText: string
  headers: Map<string, string>
  body: Buffer
}

export interface HttpRequest {
  method: string
  path: string
  protocol: string
  headers: Map<string, string>
  body: Buffer
}

export interface HttpFramedChannelEvents {
  response: (response: HttpResponse) => void
  request: (request: HttpRequest) => void
  error: (error: Error) => void
}

type PendingMessage =
  | { type: 'response'; data: Partial<HttpResponse> }
  | { type: 'request'; data: Partial<HttpRequest> }

const logger = createLogger('bunatv:http:framed-channel')

export class HttpFramedChannel extends EventEmitter<HttpFramedChannelEvents> {
  private readonly bufferPool = new BufferPool()
  private readonly streamBuffer: StreamBuffer
  private encryptedBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private pendingMessage: PendingMessage | null = null
  private expectedBodyLength = 0
  private hapFrame: HapFrameLayer

  constructor(
    private readonly transport: BunTCPTransport,
    private readonly encryption: ChaCha20EncryptionLayer
  ) {
    super()
    this.streamBuffer = new StreamBuffer(4096, 1048576, this.bufferPool)
    this.hapFrame = new HapFrameLayer(encryption)

    this.transport.on('data', (data: Buffer) => {
      this.handleData(data)
    })
  }

  get localAddress(): string | undefined {
    return this.transport.localAddress
  }

  get remoteAddress(): string | undefined {
    return this.transport.remoteAddress
  }

  private handleData(data: Buffer): void {
    if (this.hapFrame?.isEnabled) {
      this.encryptedBuffer = Buffer.concat([this.encryptedBuffer, data])
      const { decrypted, remaining } = this.hapFrame.decrypt(this.encryptedBuffer)
      this.encryptedBuffer = remaining

      // Only append if we got decrypted data
      if (decrypted.length > 0) {
        this.streamBuffer.append(decrypted)
      }
    } else {
      this.streamBuffer.append(data)
    }

    this.parseMessages()
  }

  private parseMessages(): void {
    while (this.streamBuffer.available > 0) {
      if (!this.pendingMessage) {
        const headerEndPos = this.findHeaderEnd()
        if (headerEndPos === -1) return

        const headerData = this.streamBuffer.consume(headerEndPos + 4)!
        const headerSection = headerData.subarray(0, headerEndPos).toString('utf-8')

        const lines = headerSection.split('\r\n') as [string, ...string[]]
        const firstLine = lines[0]

        // Parse headers (common to both request and response)
        const headers = new Map<string, string>()
        for (let i = 1; i < lines.length; i++) {
          const colonIdx = lines[i]!.indexOf(':')
          if (colonIdx > 0) {
            const key = lines[i]!.substring(0, colonIdx).trim().toLowerCase()
            const value = lines[i]!.substring(colonIdx + 1).trim()
            headers.set(key, value)
          }
        }

        // Determine if this is a request or response based on the first line
        const responseMatch = firstLine.match(/^(?:HTTP|RTSP)\/\d\.\d\s+(\d+)\s*(.*)$/)
        const requestMatch = firstLine.match(/^([A-Z]+)\s+(\S+)\s+(HTTP|RTSP)\/\d\.\d$/)

        if (responseMatch) {
          if (responseMatch[1] == null) {
            logger.error({ statusLine: firstLine }, 'Invalid status code')
            this.emit('error', new Error(`Invalid status code: ${firstLine}`))
            return
          }
          this.pendingMessage = {
            type: 'response',
            data: {
              statusCode: parseInt(responseMatch[1], 10),
              statusText: responseMatch[2] ?? '',
              headers,
            },
          }
        } else if (requestMatch) {
          this.pendingMessage = {
            type: 'request',
            data: {
              method: requestMatch[1],
              path: requestMatch[2],
              protocol: `${requestMatch[3]}/1.0`,
              headers,
            },
          }
        } else {
          logger.error({ firstLine }, 'Invalid HTTP message first line')
          this.emit('error', new Error(`Invalid HTTP message: ${firstLine}`))
          return
        }

        this.expectedBodyLength = parseInt(headers.get('content-length') || '0', 10)
      }

      // Check if we have the full body
      if (this.streamBuffer.available < this.expectedBodyLength) {
        return // Need more data
      }

      const body = this.streamBuffer.consume(this.expectedBodyLength)!

      if (this.pendingMessage.type === 'response') {
        const response: HttpResponse = {
          statusCode: this.pendingMessage.data.statusCode!,
          statusText: this.pendingMessage.data.statusText!,
          headers: this.pendingMessage.data.headers!,
          body,
        }

        this.pendingMessage = null
        this.expectedBodyLength = 0

        logger.debug(
          {
            statusCode: response.statusCode,
            bodyLength: response.body.length,
            headers: Object.fromEntries(response.headers),
          },
          'Received HTTP response'
        )
        logger.trace(
          {
            statusCode: response.statusCode,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            body: response.body.toString('utf-8'),
          },
          'Full HTTP response'
        )

        this.emit('response', response)
      } else {
        const request: HttpRequest = {
          method: this.pendingMessage.data.method!,
          path: this.pendingMessage.data.path!,
          protocol: this.pendingMessage.data.protocol!,
          headers: this.pendingMessage.data.headers!,
          body,
        }

        logger.debug(
          { method: request.method, path: request.path, bodyLength: request.body.length },
          'Received HTTP request'
        )
        logger.trace(
          {
            method: request.method,
            path: request.path,
            protocol: request.protocol,
            headers: Object.fromEntries(request.headers),
            body: request.body.toString('utf-8'),
          },
          'Full HTTP request'
        )

        this.emit('request', request)
      }

      this.pendingMessage = null
      this.expectedBodyLength = 0
    }
  }

  private findHeaderEnd(): number {
    // Search for \r\n\r\n in available data
    for (let i = 0; i <= this.streamBuffer.available - 4; i++) {
      const chunk = this.streamBuffer.peek(4, i)
      if (
        chunk &&
        chunk[0] === 0x0d &&
        chunk[1] === 0x0a &&
        chunk[2] === 0x0d &&
        chunk[3] === 0x0a
      ) {
        return i
      }
    }
    return -1
  }

  async sendResponse(response: HttpResponse): Promise<void> {
    const writer = new BufferWriter(512, this.bufferPool)

    writer.writeUtf8(`HTTP/1.1 ${response.statusCode} ${response.statusText}\r\n`)

    for (const [key, value] of response.headers.entries()) {
      writer.writeUtf8(`${key}: ${value}\r\n`)
    }

    if (response.body && !response.headers.has('Content-Length')) {
      writer.writeUtf8(`Content-Length: ${response.body.length}\r\n`)
    }

    writer.writeUtf8('\r\n')

    if (response.body) {
      writer.writeBuffer(response.body)
    }

    let responseBuffer = writer.toBuffer()

    // Encrypt if enabled
    if (this.hapFrame?.isEnabled) {
      responseBuffer = this.hapFrame.encrypt(responseBuffer)
    }

    logger.debug({ statusCode: response.statusCode }, 'Sending HTTP response')

    await this.transport.send(responseBuffer)
  }
  async sendRequest(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: Buffer,
    protocol: 'HTTP/1.1' | 'RTSP/1.0' = 'HTTP/1.1'
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const writer = new BufferWriter(512, this.bufferPool)

      writer.writeUtf8(`${method} ${path} ${protocol}\r\n`)

      for (const [key, value] of Object.entries(headers)) {
        writer.writeUtf8(`${key}: ${value}\r\n`)
      }

      if (body && !headers['Content-Length']) {
        writer.writeUtf8(`Content-Length: ${body.length}\r\n`)
      }

      writer.writeUtf8('\r\n')

      if (body) {
        writer.writeBuffer(body)
      }

      let requestBuffer = writer.toBuffer()


      const asdad = requestBuffer.toString('hex')
      logger.trace(
        {
          method,
          path,
          requestData: asdad,
          encryption: this.hapFrame.isEnabled,
        },
        'Sending HTTP request'
      )
      // Encrypt if enabled
      if (this.hapFrame?.isEnabled) {
        requestBuffer = this.hapFrame.encrypt(requestBuffer)
      }

      const handler = (response: HttpResponse) => {
        resolve(response)
      }
      this.once('response', handler)

      logger.debug({ method, path, headers }, `Sending ${protocol} request`)


      this.transport.send(requestBuffer).catch(err => {
        this.off('response', handler)
        reject(err)
      })
    })
  }

  // Convenience methods
  async get(path: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.sendRequest('GET', path, headers)
  }

  async post(path: string, body?: Buffer, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.sendRequest('POST', path, headers, body, 'HTTP/1.1')
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect('HttpFramedChannel disconnect requested')
  }
}
