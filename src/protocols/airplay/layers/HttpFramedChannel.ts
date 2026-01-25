import { EventEmitter } from 'eventemitter3'
import { createLogger } from '@/logging/logging'
import type { BunTCPTransport } from '@/protocols/companion/layers/BunTCPTransport.ts'
import type { ChaCha20EncryptionLayer } from '@/protocols/companion/layers/ChaCha20EncryptionLayer.ts'
import {
  BufferPool,
  StreamBuffer,
  BufferWriter,
  BunOptimizedUtils,
} from '@/core/encoding/buffer-utils.ts'

export interface HttpResponse {
  statusCode: number
  statusText: string
  headers: Map<string, string>
  body: Buffer
}

export interface HttpFramedChannelEvents {
  response: (response: HttpResponse) => void
  error: (error: Error) => void
}

const logger = createLogger('bunatv:http:framed-channel')

export class HttpFramedChannel extends EventEmitter<HttpFramedChannelEvents> {
  private readonly bufferPool = new BufferPool()
  private readonly streamBuffer: StreamBuffer
  private encryptedBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private pendingResponse: Partial<HttpResponse> | null = null
  private expectedBodyLength = 0

  constructor(
    private readonly transport: BunTCPTransport,
    private readonly encryption?: ChaCha20EncryptionLayer
  ) {
    super()
    this.streamBuffer = new StreamBuffer(4096, 1048576, this.bufferPool)

    this.transport.on('data', (data: Buffer) => {
      this.handleData(data)
    })
  }

  private handleData(data: Buffer): void {
    if (this.encryption?.isEnabled) {
      // Append to encrypted buffer first
      this.encryptedBuffer = Buffer.concat([this.encryptedBuffer, data])

      // Try to decrypt complete frames
      const { decrypted, remaining } = this.decryptHapFrames(this.encryptedBuffer)
      this.encryptedBuffer = remaining

      // Only append if we got decrypted data
      if (decrypted.length > 0) {
        this.streamBuffer.append(decrypted)
      }
    } else {
      this.streamBuffer.append(data)
    }

    this.parseResponses()
  }

  private decryptHapFrames(encrypted: Buffer): {
    decrypted: Buffer
    remaining: Buffer
  } {
    const decryptedChunks: Buffer[] = []
    let offset = 0

    while (offset < encrypted.length) {
      // Need at least length header
      if (encrypted.length - offset < 2) break

      const length = encrypted.readUInt16LE(offset)
      const frameEnd = offset + 2 + length + 16

      // Don't have complete frame yet
      if (encrypted.length < frameEnd) break

      const ciphertext = encrypted.subarray(offset + 2, frameEnd)
      const aad = encrypted.subarray(offset, offset + 2)

      const decrypted = this.encryption!.decrypt(ciphertext, aad)
      decryptedChunks.push(decrypted)

      offset = frameEnd
    }

    return {
      decrypted:
        decryptedChunks.length > 0 ? BunOptimizedUtils.concat(decryptedChunks) : Buffer.alloc(0),
      remaining: encrypted.subarray(offset), // Keep incomplete frame
    }
  }

  private parseResponses(): void {
    while (this.streamBuffer.available > 0) {
      if (!this.pendingResponse) {
        const headerEndPos = this.findHeaderEnd()
        if (headerEndPos === -1) return

        const headerData = this.streamBuffer.consume(headerEndPos + 4)!
        const headerSection = headerData.subarray(0, headerEndPos).toString('utf-8')

        // type assertion: first line + headers as its already validated above
        const lines = headerSection.split('\r\n') as [string, ...string[]]
        const statusMatch = lines[0].match(/^(?:HTTP|RTSP)\/\d\.\d\s+(\d+)\s+(.*)$/)

        if (!statusMatch) {
          logger.error({ statusLine: lines[0] }, 'Invalid status line')
          this.emit('error', new Error(`Invalid status line: ${lines[0]}`))
          return
        }

        const headers = new Map<string, string>()
        for (let i = 1; i < lines.length; i++) {
          const colonIdx = lines[i]!.indexOf(':')
          if (colonIdx > 0) {
            const key = lines[i]!.substring(0, colonIdx).trim().toLowerCase()
            const value = lines[i]!.substring(colonIdx + 1).trim()
            headers.set(key, value)
          }
        }
        if (statusMatch[1] == null) {
          logger.error({ statusLine: lines[0] }, 'Invalid status code')
          this.emit('error', new Error(`Invalid status code: ${lines[0]}`))
          return
        }
        this.pendingResponse = {
          statusCode: parseInt(statusMatch[1], 10),
          statusText: statusMatch[2],
          headers,
        }

        this.expectedBodyLength = parseInt(headers.get('content-length') || '0', 10)
      }

      // Check if we have the full body
      if (this.streamBuffer.available < this.expectedBodyLength) {
        return // Need more data
      }

      const body = this.streamBuffer.consume(this.expectedBodyLength)!

      const response: HttpResponse = {
        statusCode: this.pendingResponse.statusCode!,
        statusText: this.pendingResponse.statusText!,
        headers: this.pendingResponse.headers!,
        body,
      }

      this.pendingResponse = null
      this.expectedBodyLength = 0

      logger.debug(
        { statusCode: response.statusCode, bodyLength: response.body.length },
        'Received HTTP response'
      )

      this.emit('response', response)
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

      // Encrypt if enabled
      if (this.encryption?.isEnabled) {
        requestBuffer = this.encryptHapFrame(requestBuffer)
      }

      const handler = (response: HttpResponse) => {
        resolve(response)
      }
      this.once('response', handler)

      this.transport.send(requestBuffer).catch(err => {
        this.off('response', handler)
        reject(err)
      })
    })
  }

  private encryptHapFrame(plaintext: Buffer): Buffer {
    const frames: Buffer[] = []
    let offset = 0

    // HAP max frame size is 1024 bytes
    while (offset < plaintext.length) {
      const chunk = plaintext.subarray(offset, offset + 1024)
      const lengthBytes = Buffer.alloc(2)
      lengthBytes.writeUInt16LE(chunk.length, 0)

      const ciphertext = this.encryption!.encrypt(chunk, lengthBytes)
      frames.push(Buffer.concat([lengthBytes, ciphertext]))

      offset += chunk.length
    }

    return BunOptimizedUtils.concat(frames)
  }

  // Convenience methods
  async get(path: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.sendRequest('GET', path, headers)
  }

  async post(path: string, body?: Buffer, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.sendRequest('POST', path, headers, body, 'HTTP/1.1')
  }

}
