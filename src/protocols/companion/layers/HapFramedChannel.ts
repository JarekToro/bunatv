import type { BunTCPTransport } from "@/protocols/shared/layers/BunTCPTransport.ts";
import {
  type HAPFrame,
  HapFrameHandler,
  HAPFrameType,
} from "@/protocols/companion/layers/HapFrameHandler.ts";
import { EventEmitter } from "eventemitter3";
import type { ChaCha20EncryptionLayer } from "@/protocols/shared/layers/ChaCha20EncryptionLayer.ts";
import type { CompanionOpackMessage } from "@/protocols/companion/messages/CompanionOpackMessage.ts";
import { OPACK } from "@/core/encoding/opack.ts";
import { createLogger } from "@/logging/logging.ts";

export interface HapFramedChannelEvents {
  frame: (frame: HAPFrame) => void;
  message: (message: CompanionOpackMessage) => void;
}
const logger = createLogger("bunatv:hap:framed-channel");

export class HapFramedChannel extends EventEmitter<HapFramedChannelEvents> {
  private readonly frameHandler: HapFrameHandler;
  constructor(
    private readonly transport: BunTCPTransport,
    private readonly encryption: ChaCha20EncryptionLayer
  ) {
    super();
    this.frameHandler = new HapFrameHandler({
      validateFrames: false,
    });
    this.frameHandler.on("frame", (frame: HAPFrame) => {
      try {
        if (frame.encrypted) {
          if (!this.encryption.isEnabled) {
            console.warn(
              "Received encrypted frame but encryption is not enabled. Discarding frame."
            );
          }
          const header = Buffer.allocUnsafe(4);
          header[0] = frame.type;
          header.writeUIntBE(frame.payload.length, 1, 3);
          const decryptedPayload = this.encryption.decrypt(
            frame.payload,
            header
          );
          if (frame.type === HAPFrameType.EncryptedOpack) {
            this.emit(
              "message",
              OPACK.decode(decryptedPayload) as CompanionOpackMessage
            );
          }
        }

        this.emit("frame", frame);
      } catch (error) {
        logger.error({ error }, "Error processing received frame");
      }
    });

    this.transport.on("data", (data: Buffer) => {
      logger.debug({ dataLength: data.length }, "Received data");
      this.frameHandler.push(data);
    });
  }

  isReady() {
    return this.transport.isConnected;
  }
  isEncrypted() {
    return this.encryption.isEnabled;
  }

  async sendFrame(frameType: HAPFrameType, payload: Buffer) {
    let outgoingPayload = payload;
    if (this.encryption.isEnabled) {
      // Build frame header BEFORE encryption (required for AAD)
      // Length = payload + 16 bytes for Poly1305 auth tag
      const payloadLengthWithTag = payload.length + 16;
      const header = Buffer.allocUnsafe(4);
      header[0] = frameType;
      header.writeUIntBE(payloadLengthWithTag, 1, 3); // 3-byte length, big-endian
      outgoingPayload = this.encryption.encrypt(payload, header);
    }
    const frameBuffer = this.frameHandler.encode(outgoingPayload, frameType);
    await this.transport.send(frameBuffer);
  }

  async sendMessage(message: CompanionOpackMessage) {
    const encodedMessage = OPACK.encode(message);

    await this.sendFrame(HAPFrameType.EncryptedOpack, encodedMessage);
  }
}
