import { BunTCPTransport } from '@/protocols/shared/layers/BunTCPTransport.ts'
import { ChaCha20EncryptionLayer } from '@/protocols/shared/layers/ChaCha20EncryptionLayer.ts'
import { HapFrameLayer } from '@/protocols/airplay/layers/HapFrameLayer.ts'
import { EventEmitter } from 'eventemitter3'
import { NonceFormat } from '@/core/encoding/buffer-utils.ts'
import { HkdfUtils } from '@/core/crypto/hkdf.ts'
import { DataStreamChannel } from '@/protocols/airplay/layers/DataStreamChannel.ts'
import { HttpFramedChannel } from '@/protocols/airplay/layers/HttpFramedChannel.ts'
import { createLogger } from '@/logging/logging.ts'

const logger = createLogger('bunatv:airplay:event-stream-channel')

export class EventStreamChannel  {

  private transport: BunTCPTransport = new BunTCPTransport()
  private eventChannel: HttpFramedChannel
  constructor(
    private connectionInfo: { address: string, port: number },
    private encryptionLayer: ChaCha20EncryptionLayer,
  ) {
    // Connect event channel
    this.eventChannel = new HttpFramedChannel(this.transport, this.encryptionLayer)
  }

  async start(){
    await this.transport.connect(this.connectionInfo.address, this.connectionInfo.port)
    this.eventChannel.on('request', r => {
      logger.debug(r, 'Event channel response received:')

      const headers = new Map<string, string>()
      if (r.headers.has('server')) {
        headers.set('Server', r.headers.get('server')!)
      }
      if (r.headers.has('cseq')) {
        headers.set('CSeq', r.headers.get('cseq')!)
      }
      headers.set('Content-Length', '0')
      headers.set('Audio-Latency', '0')
      logger.debug('Sending event channel response')
      this.eventChannel?.sendResponse({
        statusCode: 200,
        statusText: 'OK',
        headers: headers,
        body: Buffer.from(''),
      })
    })

  }

  disconnect() {
    return this.transport.disconnect()
  }
}
