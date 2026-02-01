import { EventEmitter } from "eventemitter3";
import type { Airplay2Session } from "@/protocols/airplay/layers/AIrplay2Session.ts";
import {
  buildProtocolMessageForPayload,
  ProtocolMessageExtensionDisplayNameMap,
  type ProtocolMessagePayload,
  type ProtocolMessageResult,
  resolveProtocolMessage,
} from "@/protocols/mrp/generated/ProtocolMessageResolver.ts";
import {
  ErrorCode_Enum,
  ProtocolMessage,
  ProtocolMessage_Type,
} from "@/protocols/mrp/generated/ProtocolMessage.ts";
import { createLogger } from "@/logging/logging.ts";
import { GenericMessage } from "@/protocols/mrp/generated/GenericMessage.ts";
import { DeviceInfoMessage } from "@/protocols/mrp/generated/DeviceInfoMessage.ts";
import type { ClientDeviceInfo } from "@/core/client-identity.ts";
import {
  SetConnectionStateMessage,
  SetConnectionStateMessage_ConnectionState,
} from "@/protocols/mrp/generated/SetConnectionStateMessage.ts";
import { ClientUpdatesConfigMessage } from "@/protocols/mrp/generated/ClientUpdatesConfigMessage.ts";
import { GetKeyboardSessionMessage } from "@/protocols/mrp/generated/GetKeyboardSessionMessage.ts";
import { MRPCapture } from "@/logging/MRPCapture.ts";

const logger = createLogger("bunatv:mrp:protocol");

// ============================================================================
// Types
// ============================================================================

export type MRPProtocolEvents = {
  message: (message: ProtocolMessageResult) => void;
} & {
  [K in keyof typeof ProtocolMessageExtensionDisplayNameMap as `message:${(typeof ProtocolMessageExtensionDisplayNameMap)[K]}`]: (
    message: ProtocolMessageResult & { extensionType: K }
  ) => void;
};

export class MRPError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = "MRPError";
  }
}

interface OutstandingRequest {
  resolve: (message: ProtocolMessageResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ============================================================================
// MRPProtocol Implementation
// ============================================================================

export class MRPProtocol extends EventEmitter<MRPProtocolEvents> {
  private readonly outstanding = new Map<string, OutstandingRequest>();
  private readonly defaultTimeout = 5000; // 5 seconds
  private readonly capture = new MRPCapture();

  constructor(
    private airPlaySession: Airplay2Session,
    private clientDeviceInfo: ClientDeviceInfo
  ) {
    super();
  }

  async start() {
    if (!this.airPlaySession.dataChannel) {
      throw new Error("AirPlay data channel is not available");
    }
    if (this.airPlaySession.dataChannel.isConnected) {
      await this._setup();
      return;
    }

    await this.airPlaySession.dataChannel.waitFor("connectionStatus", {
      filter: (state) => state === "connected",
      timeout: 5000,
    });
    await this._setup();
  }

  private async _setup() {
    this.airPlaySession.dataChannel?.on("protobuf", (data: Buffer) => {
      this.messageReceived(data);
    });
    this.airPlaySession.dataChannel?.once(
      "connectionStatus",
      async (state) => {
        await this.tearDown();
      },
      { filter: (state) => state === "disconnected" }
    );
    await this.sendDeviceInfoMessage();
    await this.sendConnectionStateMessage();
    await this.sendClientUpdatesConfigMessage();
    await this.sendKeyboardSessionMessage();
  }

  private async tearDown() {
    logger.debug(
      { count: this.outstanding.size },
      "Cleaning up outstanding MRP requests"
    );
    for (const [identifier, request] of this.outstanding) {
      clearTimeout(request.timeout);
      request.reject(new MRPError("Protocol cleanup", "CLEANUP"));
    }
    this.outstanding.clear();
    await this.capture.close();
  }

  private sendDeviceInfoMessage() {
    const deviceInfoProto = DeviceInfoMessage.create({
      uniqueIdentifier: this.clientDeviceInfo.deviceId,
      name: this.clientDeviceInfo.name,
      localizedModelName: "iPhone",
      systemBuildVersion: this.clientDeviceInfo.osVersion,
      applicationBundleIdentifier: "com.apple.TVRemote",
      applicationBundleVersion: "344.28",
      protocolVersion: 1,
      lastSupportedMessageType: 108,
      supportsSystemPairing: true,
      allowsPairing: true,
      systemMediaApplication: "com.apple.TVMusic",
      supportsACL: true,
      supportsSharedQueue: true,
      supportsExtendedMotion: true,
      sharedQueueVersion: 2,
      deviceClass: 1, // iPhone (see Common.proto for DeviceClass enum)
      logicalDeviceCount: 1,
    });

    return this.sendAndReceive({
      extensionType: ProtocolMessage_Type.DEVICE_INFO_MESSAGE,
      message: deviceInfoProto,
    });
  }

  private async sendConnectionStateMessage() {
    const connectionStateProto = SetConnectionStateMessage.create({
      state: SetConnectionStateMessage_ConnectionState.Connected,
    });
    return this.send({
      extensionType: ProtocolMessage_Type.SET_CONNECTION_STATE_MESSAGE,
      message: connectionStateProto,
    });
  }
  private async sendClientUpdatesConfigMessage() {
    const clientUpdatesConfigProto = ClientUpdatesConfigMessage.create({
      artworkUpdates: true,
      keyboardUpdates: true,
      nowPlayingUpdates: false,
      volumeUpdates: true,
      outputDeviceUpdates: true,
    });
    return this.sendAndReceive({
      extensionType: ProtocolMessage_Type.CLIENT_UPDATES_CONFIG_MESSAGE,
      message: clientUpdatesConfigProto,
    });
  }

  private async sendKeyboardSessionMessage() {
    const keyboardSessionProto = GetKeyboardSessionMessage.create();
    return this.sendAndReceive({
      extensionType: ProtocolMessage_Type.GET_KEYBOARD_SESSION_MESSAGE,
      message: keyboardSessionProto,
    });
  }

  /**
   * Send a message and expect no response
   */
  send(payload: ProtocolMessagePayload): void {
    let protocolMessage = ProtocolMessage.create({
      type: payload.extensionType,
      identifier: Bun.randomUUIDv7(),
      uniqueIdentifier: Bun.randomUUIDv7(),
      errorCode: ErrorCode_Enum.NoError,
    });

    protocolMessage = buildProtocolMessageForPayload(protocolMessage, payload);
    const encoded = ProtocolMessage.encode(protocolMessage).finish();

    logger.debug(
      {
        type: payload.extensionType,
        identifier: protocolMessage.identifier,
        messageType:
          ProtocolMessageExtensionDisplayNameMap[payload.extensionType],
      },
      "Sending MRP message (no response expected)"
    );

    this.airPlaySession.dataChannel?.sendProtobuf(encoded);
    void this.capture.captureSent(encoded, payload.extensionType, payload);
  }

  /**
   * Send a message and wait for a response
   */
  async sendAndReceive(
    payload: ProtocolMessagePayload,
    options?: {
      generateIdentifier?: boolean;
      timeout?: number;
    }
  ): Promise<ProtocolMessageResult> {
    const generateIdentifier = options?.generateIdentifier ?? true;
    const timeout = options?.timeout ?? this.defaultTimeout;

    let protocolMessage = ProtocolMessage.create({
      type: payload.extensionType,
      identifier: generateIdentifier ? Bun.randomUUIDv7() : undefined,
      uniqueIdentifier: Bun.randomUUIDv7(),
      errorCode: ErrorCode_Enum.NoError,
    });

    // Some messages will respond with the same identifier as used in the
    // corresponding request. Others will not and one example is the crypto
    // message (for pairing). They will never include an identifier, but it
    // is in turn only possible to have one of those message outstanding
    // at one time (i.e. it's not possible to mix up the responses). In
    // those cases, a "fake" identifier is used that includes the message
    // type instead.
    const identifier = generateIdentifier
      ? protocolMessage.identifier!
      : `type_${payload.extensionType}`;

    protocolMessage = buildProtocolMessageForPayload(protocolMessage, payload);
    const encoded = ProtocolMessage.encode(protocolMessage).finish();

    logger.debug(
      {
        type: payload.extensionType,
        identifier: protocolMessage.identifier,
        messageType:
          ProtocolMessageExtensionDisplayNameMap[payload.extensionType],
      },
      "Sending MRP message (no response expected)"
    );

    this.airPlaySession.dataChannel?.sendProtobuf(encoded);

    await this.capture.captureSent(encoded, payload.extensionType, payload);
    return this.receive(identifier, timeout);
  }

  /**
   * Wait for a response with the given identifier
   */
  private async receive(
    identifier: string,
    timeout: number
  ): Promise<ProtocolMessageResult> {
    const error = new MRPError("Request timeout", "TIMEOUT");
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        logger.warn({ identifier, timeout }, "MRP request timeout");
        this.outstanding.delete(identifier);
        reject(error);
      }, timeout);

      // Store outstanding request
      this.outstanding.set(identifier, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });
    });
  }

  /**
   * Handle incoming message from device
   */
  messageReceived(buffer: Buffer): void {
    try {
      // Decode the protocol message
      const resolved = resolveProtocolMessage(buffer);

      logger.trace(
        {
          type: resolved.extensionType,
          identifier: resolved.message.identifier,
        },
        "MRP message received"
      );

      // If the message identifier is outstanding, then someone is
      // waiting for the response so we save it here
      const identifier =
        resolved.message.identifier || `type_${resolved.message.type}`;
      const outstanding = this.outstanding.get(identifier);

      if (outstanding) {
        logger.trace({ identifier }, "Found outstanding request for message");
        clearTimeout(outstanding.timeout);
        this.outstanding.delete(identifier);

        // Check for error
        const hasError =
          resolved.message.errorCode !== undefined &&
          resolved.message.errorCode !== ErrorCode_Enum.NoError;
        if (hasError) {
          logger.warn(
            {
              errorCode: resolved.message.errorCode,
              errorDescription: resolved.message.errorDescription,
              identifier,
            },
            "MRP request failed with error"
          );
          outstanding.reject(
            new MRPError(
              resolved.message.errorDescription || "Request failed",
              `ERROR_${resolved.message.errorCode}`
            )
          );
        } else {
          logger.debug({ identifier }, "MRP request completed successfully");
          outstanding.resolve(resolved);
        }
      } else {
        // Emit as unsolicited message
        logger.debug(
          { type: resolved.extensionType, identifier },
          "Emitting unsolicited MRP message"
        );
      }

      void this.capture.captureReceived(
        buffer,
        resolved.extensionType,
        resolved
      );

      this.emit("message", resolved);
      this.emit(
        //@ts-expect-error -- TS can't figure out the mapping here
        "message:" +
          ProtocolMessageExtensionDisplayNameMap[resolved.extensionType!],
        resolved
      );
    } catch (error) {
      logger.error({ error }, "Failed to handle MRP message");
    }
  }
}
