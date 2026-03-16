import { BunTCPTransport } from "@/protocols/shared/layers/BunTCPTransport.ts";
import type { ChaCha20EncryptionLayer } from "@/protocols/shared/layers/ChaCha20EncryptionLayer.ts";
import { HapFrameLayer } from "@/protocols/airplay/layers/HapFrameLayer.ts";
import { EventEmitter } from "eventemitter3";
import {
  BufferPool,
  StreamBuffer,
  BufferReader,
  BufferWriter,
  BunOptimizedUtils,
} from "@/core/encoding/buffer-utils.ts";
import { createLogger } from "@/logging/logging";
import {
  Plist,
  plistObjectGuard,
  type PlistValue,
} from "@/core/encoding/plist.ts";
import { ConnectionState } from "@/protocols/types/ConnectionState.ts";
import { EmitterEx } from "@/core/eventing/EmitterEx.ts";

const logger = createLogger("bunatv:airplay:data-stream-channel");

// Constants from pyatv
const DATA_HEADER_SIZE = 32;
const DATA_HEADER_PADDING = 0x00000000;

// Message types
const MSG_TYPE_SYNC = Buffer.from("sync\x00\x00\x00\x00\x00\x00\x00\x00");
const MSG_TYPE_REPLY = Buffer.from("rply\x00\x00\x00\x00\x00\x00\x00\x00");
const CMD_COMM = Buffer.from("comm");
const CMD_EMPTY = Buffer.alloc(4);

export interface DataStreamMessage {
  messageType: Buffer;
  command: Buffer;
  seqno: bigint;
  padding: number;
  payload: Buffer;
}

export interface DataStreamChannelEvents {
  /** Emitted when a protobuf message is received */
  protobuf: (message: Buffer) => void;
  /** Emitted on error */
  error: (error: Error) => void;
  /** Emitted on connection state change */
  connectionStatus: (state: ConnectionState) => void;
}

export class DataStreamChannel extends EmitterEx<DataStreamChannelEvents> {
  private readonly hapFrame: HapFrameLayer;
  private readonly transport: BunTCPTransport = new BunTCPTransport();
  private encryptedBuffer: Buffer = Buffer.alloc(0);
  private readonly streamBuffer: StreamBuffer;
  private readonly bufferPool: BufferPool;
  private sendSeqno: bigint;
  private _connectionState: ConnectionState = ConnectionState.UNKNOWN;
  public get connectionState(): ConnectionState {
    return this._connectionState;
  }
  public get isConnected(): boolean {
    return this._connectionState === ConnectionState.CONNECTED;
  }

  constructor(
    private connectionInfo: { address: string; port: number },
    encryption: ChaCha20EncryptionLayer
  ) {
    super();
    this.bufferPool = new BufferPool();
    this.streamBuffer = new StreamBuffer(4096, 1048576, this.bufferPool);
    this.hapFrame = new HapFrameLayer(encryption);

    // Random start seqno between 0x100000000 and 0x1FFFFFFFF (like pyatv)
    this.sendSeqno = BigInt(
      Math.floor(Math.random() * 0xffffffff) + 0x100000000
    );

    this.transport.on("data", (data: Buffer) => this.handleData(data));
    this.transport.on("error", (err: Error) => this.emit("error", err));
    this.transport.on("connectionStatus", async (state: ConnectionState) => {
      if (state === ConnectionState.DISCONNECTED) {
        await this.teardown();
      }
    });
  }

  async connect(): Promise<void> {
    if (
      this._connectionState === ConnectionState.CONNECTED ||
      this._connectionState === ConnectionState.CONNECTING
    ) {
      logger.debug("Data stream channel already connected or connecting");
      return;
    }
    this.updateConnectionState(ConnectionState.CONNECTING);
    await this.transport.connect(
      this.connectionInfo.address,
      this.connectionInfo.port
    );
    logger.debug(
      { address: this.connectionInfo.address, port: this.connectionInfo.port },
      "Data stream channel connected"
    );
    this.updateConnectionState(ConnectionState.CONNECTED);
  }

  private updateConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state;
      this.emit("connectionStatus", state);
    }
  }

  /**
   * Send a protobuf message over the data channel
   */
  async sendProtobuf(protobufData: Uint8Array<ArrayBufferLike>): Promise<void> {
    const payload = Plist.encode({
      params: {
        data: BunOptimizedUtils.ensureArrayBuffer(
          this.encodeProtobufs([Buffer.from(protobufData)])
        ),
      },
    });

    const message: DataStreamMessage = {
      messageType: MSG_TYPE_SYNC,
      command: CMD_COMM,
      seqno: this.sendSeqno++,
      padding: DATA_HEADER_PADDING,
      payload: Buffer.from(payload),
    };

    logger.trace({ message }, "Sending protobuf message");
    const encoded = this.encodeMessage(message);
    logger.trace({ encoded }, "Encoded protobuf message");

    const encrypted = this.hapFrame.encrypt(encoded);
    await this.transport.send(encrypted);

    logger.debug(
      { seqno: this.sendSeqno.toString(), payloadSize: payload.byteLength },
      "Sent protobuf message"
    );
    // await Bun.write(`./${this.sendSeqno.toString(10)}-message.bin`, encoded)
  }

  private async teardown(): Promise<void> {
    logger.debug("Tearing down data stream channel");
    this.streamBuffer.reset();
    this.encryptedBuffer = Buffer.alloc(0);
    this.updateConnectionState(ConnectionState.DISCONNECTED);
  }
  async disconnect(): Promise<void> {
    await this.teardown();
    this.transport.removeAllListeners();
    this.removeAllListeners();
    return this.transport.disconnect();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Encoding
  // ─────────────────────────────────────────────────────────────────────────────

  private encodeMessage(message: DataStreamMessage): Buffer {
    const totalSize = DATA_HEADER_SIZE + message.payload.length;
    const writer = new BufferWriter(totalSize, this.bufferPool);

    // DataHeader: size(4) + message_type(12) + command(4) + seqno(8) + padding(4)
    writer.writeUInt32BE(totalSize);
    writer.writeBuffer(message.messageType);
    writer.writeBuffer(message.command);
    // Write 64-bit seqno as two 32-bit values (big-endian)
    writer.writeUInt32BE(Number(message.seqno >> 32n));
    writer.writeUInt32BE(Number(message.seqno & 0xffffffffn));
    writer.writeUInt32BE(message.padding);
    writer.writeBuffer(message.payload);

    return writer.toBuffer();
  }

  private encodeReply(seqno: bigint): Buffer {
    return this.encodeMessage({
      messageType: MSG_TYPE_REPLY,
      command: CMD_EMPTY,
      seqno,
      padding: DATA_HEADER_PADDING,
      payload: Buffer.alloc(0),
    });
  }

  private encodeProtobufs(messages: Buffer[]): Buffer {
    // Each protobuf is prefixed with a varint length
    const chunks: Buffer[] = [];
    for (const msg of messages) {
      chunks.push(this.writeVarint(msg.length));
      chunks.push(msg);
    }
    return Buffer.concat(chunks);
  }

  private writeVarint(value: number): Buffer {
    const bytes: number[] = [];
    while (value > 0x7f) {
      bytes.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    bytes.push(value);
    return Buffer.from(bytes);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Decoding
  // ─────────────────────────────────────────────────────────────────────────────

  private handleData(data: Buffer): void {
    if (this.hapFrame?.isEnabled) {
      this.encryptedBuffer = Buffer.concat([this.encryptedBuffer, data]);

      // Decrypt HAP frames
      const { decrypted, remaining } = this.hapFrame.decrypt(
        this.encryptedBuffer
      );
      this.encryptedBuffer = remaining;

      // Only append if we got decrypted data
      if (decrypted.length > 0) {
        this.streamBuffer.append(decrypted);
      }
    } else {
      this.streamBuffer.append(data);
    }

    this.processStream();
  }

  private processStream(): void {
    while (this.streamBuffer.available >= DATA_HEADER_SIZE) {
      const message = this.decodeMessage();
      if (!message) break;

      if (message.messageType.equals(MSG_TYPE_REPLY)) {
        logger.debug(
          { seqno: message.seqno.toString() },
          "Received reply message"
        );
        continue;
      }
      // Decode the plist payload
      const payload = this.decodePayload(message.payload);
      if (payload) {
        this.processPayload(payload, message.seqno);
      }

      // If this was a "sync" request, send a reply
      if (message.messageType.subarray(0, 4).equals(Buffer.from("sync"))) {
        const reply = this.encodeReply(message.seqno);
        const encrypted = this.hapFrame.encrypt(reply);
        this.transport.send(encrypted).catch((err) => {
          logger.error({ err }, "Failed to send reply");
        });
      }
    }
  }

  private decodeMessage(): DataStreamMessage | null {
    // Peek at header to get size
    const headerPeek = this.streamBuffer.peek(DATA_HEADER_SIZE);
    if (!headerPeek) return null;

    const reader = new BufferReader(headerPeek);
    const size = reader.readUInt32BE();

    // Check if we have the full message
    if (this.streamBuffer.available < size) {
      logger.debug(
        { available: this.streamBuffer.available, expected: size },
        "Not enough data for full message"
      );
      return null;
    }

    // Consume the full message
    const messageData = this.streamBuffer.consume(size);
    if (!messageData) return null;

    const msgReader = new BufferReader(messageData);

    const totalSize = msgReader.readUInt32BE();
    const messageType = msgReader.readBuffer(12);
    const command = msgReader.readBuffer(4);
    const seqnoHigh = msgReader.readUInt32BE();
    const seqnoLow = msgReader.readUInt32BE();
    const seqno = (BigInt(seqnoHigh) << 32n) | BigInt(seqnoLow);
    const padding = msgReader.readUInt32BE();
    const payload = msgReader.readRemaining();

    logger.debug(
      {
        size: totalSize,
        messageType: messageType.subarray(0, 4).toString(),
        command: command.toString(),
        seqno: seqno.toString(),
        payloadSize: payload.length,
      },
      "Decoded data stream message"
    );

    return { messageType, command, seqno, padding, payload };
  }

  private decodePayload(payload: Buffer): PlistValue {
    if (payload.length === 0) return null;

    try {
      return Plist.decode(
        payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength
        )
      );
    } catch (err) {
      logger.error({ err }, "Failed to decode plist payload");
      return null;
    }
  }

  private processPayload(payload: PlistValue, seqno: bigint): void {
    if (!plistObjectGuard(payload)) {
      logger.debug(
        { payload },
        "Message has unsupported format (not an object)"
      );
      return;
    }

    const params = payload.params as Record<string, unknown> | undefined;
    const data = params?.data as Buffer | undefined;

    if (!data) {
      logger.debug(
        { payload },
        "Message has unsupported format (no params.data)"
      );
      return;
    }

    // Decode protobuf messages
    const protobufs = this.decodeProtobufs(Buffer.from(data));
    for (const pb of protobufs) {
      this.emit("protobuf", pb);
    }
  }

  private decodeProtobufs(data: Buffer): Buffer[] {
    const messages: Buffer[] = [];
    let offset = 0;

    try {
      while (offset < data.length) {
        // Check if this is a non-length-prefixed message (starts with 0x08)
        // Field #1 (type) is encoded as tag 0x08
        if (data[offset] === 0x08) {
          // Not length prefixed - take the rest
          messages.push(data.subarray(offset));
          break;
        }

        // Read varint length
        const { value: length, bytesRead } = this.readVarint(data, offset);
        offset += bytesRead;

        if (offset + length > data.length) {
          logger.warn(
            { expected: length, available: data.length - offset },
            "Not enough data for protobuf"
          );
          break;
        }

        messages.push(data.subarray(offset, offset + length));
        offset += length;
      }
    } catch (err) {
      logger.error({ err }, "Failed to decode protobufs");
    }

    return messages;
  }

  private readVarint(
    data: Buffer,
    offset: number
  ): { value: number; bytesRead: number } {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;

    while (offset + bytesRead < data.length) {
      const byte = data[offset + bytesRead]!;
      value |= (byte & 0x7f) << shift;
      bytesRead++;

      if ((byte & 0x80) === 0) {
        return { value, bytesRead };
      }

      shift += 7;
      if (shift > 35) {
        throw new Error("Varint too long");
      }
    }

    throw new Error("Incomplete varint");
  }
}
