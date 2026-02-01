/**
 * HAP Protocol Implementation with Buffer Utils Integration
 */

import {
  BufferPool,
  BufferReader,
  BufferWriter,
  StreamBuffer,
} from "@/core/encoding/buffer-utils";
import { createLogger } from "@/logging/logging";
import EventEmitter from "eventemitter3";

const logger = createLogger("bunatv:hap:frame-handler");

// ============================================================================
// Core Generic Types
// ============================================================================

/**
 * Frame parse result with generic frame type
 */
export interface FrameParseResult {
  /** Successfully parsed frames */
  frames: HAPFrame[];
  /** Remaining buffer data (incomplete frame) */
  remainder: Buffer;
  /** Number of bytes consumed */
  consumed: number;
  /** Parse errors encountered */
  errors?: FrameParseError[];
}

/**
 * Frame parse error
 */
export interface FrameParseError {
  offset: number;
  message: string;
  code: string;
  context?: any;
}

/**
 * Frame handler options
 */
export interface FrameHandlerOptions {
  /** Enable frame validation */
  validateFrames?: boolean;
}
/**
 * HAP-specific frame type
 */
export interface HAPFrame {
  format: "hap";
  type: HAPFrameType;
  encrypted?: boolean;
  /** Frame payload */
  payload: Buffer;
  /** Payload length */
  length: number;
  /** Total frame size including headers */
  totalSize: number;
  /** Optional sequence number */
  sequence?: number;
  /** Frame timestamp */
  timestamp?: Date;
}

/**
 * HAP frame types
 */
export enum HAPFrameType {
  PairSetupStart = 0x03,
  PairSetupNext = 0x04,
  PairVerifyStart = 0x05,
  PairVerifyNext = 0x06,
  EncryptedOpack = 0x08,
  SessionStartRequest = 0x10, // not used session start is sent over EncryptedOpack
  SessionStartResponse = 0x11, // not used session start is sent over EncryptedOpack
  Legacy = 0xff, // Internal marker
}
const VALID_HAP_FRAME_TYPES = new Set<number>(
  Object.values(HAPFrameType).filter((v) => typeof v === "number") as number[]
);

const HapFrameUtils = {
  isValidFrameType(type: number | HAPFrameType): type is HAPFrameType {
    return VALID_HAP_FRAME_TYPES.has(type);
  },

  detectHAPFrame(data: Buffer, offset = 0): boolean {
    if (offset + 4 > data.length) {
      logger.trace(
        { dataLength: data.length, offset },
        "Insufficient data for HAP frame detection"
      );
      return false;
    }

    const firstByte = data[offset]!;

    // Check for HAP frame types (includes session start frames)
    if (
      (firstByte >= 0x03 && firstByte <= 0x08) ||
      (firstByte >= 0x10 && firstByte <= 0x11)
    ) {
      const length = data.readUIntBE(offset + 1, 3);
      const isValid = length > 0 && length <= 65536;
      logger.trace({ firstByte, length, isValid }, "HAP frame type detected");
      return isValid;
    }

    // Check for legacy format
    const legacyLength = data.readUInt32LE(offset);
    const isValid = legacyLength > 0 && legacyLength <= 65536;
    logger.trace({ legacyLength, isValid }, "Legacy HAP frame format detected");
    return isValid;
  },

  parseHAPFrame(reader: BufferReader): HAPFrame | null {
    if (reader.remaining < 4) {
      logger.trace(
        { dataLength: reader.remaining, offset: reader.currentOffset },
        "Insufficient data for HAP frame parsing"
      );
      return null;
    }

    const type = reader.readUInt8();

    if (HapFrameUtils.isValidFrameType(type)) {
      const length = reader.readUInt24BE();

      if (reader.remaining < length) {
        logger.trace(
          { type, length, available: reader.remaining },
          "Incomplete HAP frame data; waiting for more data"
        );
        reader.currentOffset -= 4; // Rewind
        return null;
      }

      return {
        format: "hap",
        type: type as HAPFrameType,
        payload: reader.readBuffer(length),
        length,
        totalSize: 4 + length,
        encrypted: type === HAPFrameType.EncryptedOpack,
      };
    }

    return null;
  },
  encode(payload: Buffer, type: HAPFrameType, pool: BufferPool): Buffer {
    const writer = new BufferWriter(4 + payload.length, pool);

    logger.trace(
      { payloadLength: payload.length, frameType: type },
      "Encoding HAP frame"
    );

    writer.writeUInt8(type);
    writer.writeUInt24BE(payload.length);

    writer.writeBuffer(payload);

    return writer.toBuffer();
  },

  getFrameSize(header: Buffer): number {
    if (header.length < 4) {
      throw new Error("Header must be at least 4 bytes");
    }

    const firstByte = header[0]!;

    // Modern HAP format: [type:1][length:3 BE]
    if (HapFrameUtils.isValidFrameType(firstByte)) {
      const length = header.readUIntBE(1, 3);
      return 4 + length; // header + payload
    }

    // Legacy format: [length:4 LE]
    const length = header.readUInt32LE(0);
    return 4 + length;
  },

  validate(frame: HAPFrame): boolean {
    const validTypes = [
      HAPFrameType.PairSetupStart,
      HAPFrameType.PairSetupNext,
      HAPFrameType.PairVerifyStart,
      HAPFrameType.PairVerifyNext,
      HAPFrameType.EncryptedOpack,
      HAPFrameType.Legacy,
    ];

    const isValidType = validTypes.includes(frame.type);
    const isLengthValid = frame.length === frame.payload.length;
    const isSizeValid = frame.length <= 65536;
    const isValid = isValidType && isLengthValid && isSizeValid;

    if (!isValid) {
      logger.warn(
        {
          type: frame.type,
          length: frame.length,
          payloadLength: frame.payload.length,
          isValidType,
          isLengthValid,
          isSizeValid,
        },
        "HAP frame validation failed"
      );
    } else {
      logger.trace(
        { type: frame.type, length: frame.length },
        "HAP frame validation passed"
      );
    }

    return isValid;
  },
};

interface HapFrameHandlerEvents {
  frame: (frame: HAPFrame) => void;
  error: (error: FrameParseError) => void;
}

// ============================================================================
// Generic Implementation
// ============================================================================

/**
 * Generic frame handler implementation
 */
export class HapFrameHandler extends EventEmitter<HapFrameHandlerEvents> {
  private sequenceNumber = 0;
  private readonly streamBuffer: StreamBuffer;
  private readonly bufferPool: BufferPool;
  private parseScheduled = false;
  constructor(public readonly options: FrameHandlerOptions = {}) {
    super();

    // Create or use injected pool
    this.bufferPool = new BufferPool({
      sizeBuckets: [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536],
      maxPerBucket: 10,
      clearOnRelease: false,
    });

    // Pass pool to StreamBuffer
    this.streamBuffer = new StreamBuffer(
      4096, // Initial size
      1048576, // Max 1MB buffer
      this.bufferPool
    );

    this.options = {
      validateFrames: true,
      ...options,
    };
  }

  encode(payload: Buffer, type: HAPFrameType): Buffer {
    logger.trace({ payloadLength: payload.length, type }, "Encoding frame");
    return HapFrameUtils.encode(payload, type, this.bufferPool);
  }

  push(data: Buffer): void {
    this.streamBuffer.append(data);
    logger.debug(
      {
        dataLength: data.length,
        bufferCapacity: this.streamBuffer.currentPoolCapacity,
      },
      "Data pushed to frame handler buffer"
    );
    if (!this.parseScheduled) {
      this.parseScheduled = true;
      queueMicrotask(() => {
        this.parseScheduled = false;
        this.process();
      });
    }
  }

  process() {
    const frames: HAPFrame[] = [];

    while (this.streamBuffer.available >= 4) {
      const peeked = this.streamBuffer.peek(4);
      if (!peeked) {
        logger.trace("Insufficient data to peek for frame header");
        break;
      }
      const isDetected = HapFrameUtils.detectHAPFrame(peeked, 0);
      if (!isDetected) {
        const error: FrameParseError = {
          offset: 0,
          message: "Invalid frame format in strict mode",
          code: "INVALID_FORMAT",
        };
        logger.warn(
          { error: error.message },
          "Invalid frame format detected in strict mode"
        );
        this.emit("error", error);
        break;
      }

      const frameSize = HapFrameUtils.getFrameSize(peeked);

      if (this.streamBuffer.available < frameSize) {
        logger.trace(
          {
            available: this.streamBuffer.available,
            needed: frameSize,
          },
          "Incomplete frame, waiting for more data"
        );
        break;
      }

      const frameData = this.streamBuffer.consume(frameSize)!;

      const reader = new BufferReader(frameData);
      const frame = HapFrameUtils.parseHAPFrame(reader);
      if (!frame) {
        logger.trace(
          "Failed to parse frame after detection, this should not happen"
        );
        break;
      }

      frame.sequence = this.sequenceNumber++;
      frame.timestamp = new Date();

      if (this.options.validateFrames) {
        const isValid = HapFrameUtils.validate(frame);

        if (!isValid) {
          logger.warn(
            {
              sequence: frame.sequence,
              protocolValid: isValid,
            },
            "Frame validation failed"
          );

          logger.warn(
            "Stopping parse due to validation failure in strict mode"
          );
          break;
        }
      }
      frames.push(frame);
    }

    frames.forEach((frame) => {
      logger.trace({ sequence: frame.sequence }, "Emitting parsed frame");
      queueMicrotask(() => {
        try {
          this.emit("frame", frame);
        } catch (error) {
          // Listener error doesn't crash parser
          logger.error(
            {
              error,
              frame: frame.sequence,
            },
            "Frame listener error"
          );

          this.emit("error", {
            offset: 0,
            message: "Listener threw error",
            code: "LISTENER_ERROR",
            context: { frame, error },
          });
        }
      });
    });
  }
}
