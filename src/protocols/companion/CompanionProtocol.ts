import { EventEmitter } from "eventemitter3";
import { CompanionSessionService } from "@/protocols/companion/layers/CompanionSessionService.ts";
import {
  type CommandOutputOf,
  type CommandResponseOf,
  type CredentialStore,
  type Protocol,
  type ProtocolEvents,
  ProtocolState,
} from "@/protocols/types/BaseProtocol.ts";
import {
  HAPAuthenticationService,
  type HAPCredentials,
} from "@/protocols/companion/layers/HAPAuthenticationService.ts";
import { RecoveryManager } from "@/core/utils/RecoveryManager.ts";
import { ProtocolStateMachine } from "@/core/utils/ProtocolStateMachine.ts";
import type { AppleDevice } from "@/core/discovery/discovery-types.ts";
import type { ClientDeviceInfo } from "@/core/client-identity.ts";
import {
  BunTCPTransport,
  type TransportOptions,
} from "@/protocols/shared/layers/BunTCPTransport.ts";
import { ConnectionState } from "@/protocols/types/ConnectionState.ts";
import { ChaCha20EncryptionLayer } from "@/protocols/shared/layers/ChaCha20EncryptionLayer.ts";
import type { Storage } from "@/core/storage/types.ts";
import { createLogger } from "@/logging/logging.ts";
import type { CompanionCommand } from "@/protocols/companion/messages/CompanionOpackMessage.ts";
import { HapFramedChannel } from "@/protocols/companion/layers/HapFramedChannel.ts";
import {
  CompanionEventTypes,
  createInterestEvent,
} from "@/protocols/companion/messages/interest.ts";
import type { CompanionOpackMessage } from "@/protocols/companion/messages/CompanionOpackMessage.ts";
import { CompanionEventMessageParser } from "@/protocols/companion/messages/CompanionEventMessageParser.ts";
import type { ParsedMediaControlEvent } from "@/protocols/companion/messages/mediaControl.ts";
import type { ParsedSystemStatusEvent } from "@/protocols/companion/messages/systemStatus.ts";
import type {
  ParsedTextInputStartedEvent,
  ParsedTextInputStoppedEvent,
} from "@/protocols/companion/messages/textInput.ts";
import type { ParsedHidTouchEvent } from "@/protocols/companion/messages/hidTouch.ts";

interface CompanionProtocolEvents extends ProtocolEvents {
  "media-control": (event: ParsedMediaControlEvent) => {};
  "system-status": (event: ParsedSystemStatusEvent) => {};
  "text-input-started": (event: ParsedTextInputStartedEvent) => {};
  "text-input-stopped": (event: ParsedTextInputStoppedEvent) => {};
  touch: (event: ParsedHidTouchEvent) => {};
  event: (messageId: string, content: any) => {};
}

const logger = createLogger("bunatv:companion:protocol");
export interface CompanionConnectionOptions {
  authOptions?: { onPinRequired?: (deviceName?: string) => Promise<string> };
  transportOptions?: TransportOptions;
}
export class CompanionProtocol
  extends EventEmitter<CompanionProtocolEvents>
  implements Protocol<CompanionProtocolEvents, CompanionConnectionOptions>
{
  private stateMachine = new ProtocolStateMachine();
  private recoveryManager = new RecoveryManager();
  private readonly credentialStore: CredentialStore<HAPCredentials>;
  private readonly transport = new BunTCPTransport();
  private readonly encryption = new ChaCha20EncryptionLayer();
  private readonly hapFramedChannel = new HapFramedChannel(
    this.transport,
    this.encryption
  );
  private readonly parser = new CompanionEventMessageParser();
  private readonly authService: HAPAuthenticationService;
  private readonly session: CompanionSessionService;
  private readonly connectionInfo: { address: string; port: number };

  static async create(
    device: AppleDevice,
    storage: Storage
  ): Promise<CompanionProtocol> {
    const clientDeviceInfo = await storage.getClientDeviceInfo();
    return new CompanionProtocol(device, storage, clientDeviceInfo);
  }

  private constructor(
    private readonly device: AppleDevice,
    private readonly storage: Storage,
    private readonly clientDeviceInfo: ClientDeviceInfo
  ) {
    super();
    if (!device.address) {
      throw new Error("Device must have a valid address");
    }
    if (!device.services.companionLink) {
      throw new Error("Device must support Companion protocol");
    }
    this.connectionInfo = {
      address: device.address,
      port: device.services?.companionLink?.port || 62078,
    };
    this.credentialStore = this.storage.getCredentialStore(
      device.identifier,
      "companion"
    );

    this.authService = new HAPAuthenticationService(
      {
        deviceId: device.identifier,
        clientDeviceInfo: this.clientDeviceInfo,
      },
      this.hapFramedChannel
    );

    this.session = new CompanionSessionService(this.hapFramedChannel);
    this.setupEventHandlers();
  }

  getClientId(): string | undefined {
    return this.authService.session?.credentials?.clientId;
  }

  private setupEventHandlers() {
    this.session.on("message", (message: CompanionOpackMessage) => {
      // Parse message
      const parsed = this.parser.parse(message);

      if (!parsed) {
        return;
      }

      // Emit typed events
      switch (parsed.type) {
        case "media-control":
          logger.trace({ event: parsed }, "Media control event");
          this.emit("media-control", parsed);
          break;
        case "system-status":
          logger.trace({ event: parsed }, "System status event");
          this.emit("system-status", parsed);
          break;
        case "text-input-started":
          logger.trace({ event: parsed }, "Text input started");
          this.emit("text-input-started", parsed);
          break;
        case "text-input-stopped":
          logger.trace({ event: parsed }, "Text input stopped");
          this.emit("text-input-stopped", parsed);
          break;
        case "touch":
          logger.trace({ event: parsed }, "Touch event");
          this.emit("touch", parsed);
          break;
        case "unknown":
          logger.trace({ messageId: parsed.messageId }, "Unknown event");
          this.emit("event", parsed.messageId, parsed.content);
          break;
      }
    });

    this.stateMachine.on("state-changed", (newState, oldState) => {
      this.emit("state-changed", newState, oldState);
      if (newState === ProtocolState.Ready) {
        this.emit("ready");
      }
    });

    this.transport.on("connectionStatus", (state) => {
      if (
        state === ConnectionState.DISCONNECTED &&
        this.state !== ProtocolState.Disconnecting &&
        this.state !== ProtocolState.Idle
      ) {
        this.handleUnexpectedDisconnect();
      }
    });

    this.transport.on("error", (error) => {
      this.emit("error", error, "transport");
    });
  }

  private async handleUnexpectedDisconnect(): Promise<void> {
    logger.warn("Transport disconnected unexpectedly");
    try {
      await this.session.stop();
    } catch {
      // Best-effort session cleanup
    }
    this.encryption.disable();
    this.cleanupListeners();
    this.stateMachine.setState(ProtocolState.Failed);
    this.emit(
      "error",
      new Error("Transport disconnected unexpectedly"),
      "transport"
    );
  }

  get state() {
    return this.stateMachine.state;
  }
  get isReady() {
    return this.stateMachine.isReady;
  }

  private async _connect(
    authOptions?: { onPinRequired?: (deviceName?: string) => Promise<string> },
    options?: TransportOptions
  ): Promise<void> {
    this.stateMachine.assertState(ProtocolState.Idle, "connect");

    this.emit("connecting");
    this.stateMachine.setState(ProtocolState.Connecting);
    await this.transport.connect(
      this.connectionInfo.address,
      this.connectionInfo.port,
      options
    );
    let credentials = await this.credentialStore.load(this.device.identifier);
    this.stateMachine.setState(ProtocolState.Authenticating);
    if (!this.authService.isAuthenticated) {
      const authSession = await this.authService.authenticate(
        credentials,
        authOptions
      );
      credentials = authSession.credentials;
      if (!credentials) {
        throw new Error("Pairing completed but no credentials returned");
      }
      await this.credentialStore.save(this.device.identifier, credentials);
    }
    const authSessionKey = this.authService.session?.keys;
    if (!authSessionKey) {
      throw new Error(
        "No authentication session key available after authentication"
      );
    }
    this.encryption.enable(authSessionKey);

    this.stateMachine.setState(ProtocolState.EstablishingSession);
    await this.session.start({
      clientDeviceInfo: this.clientDeviceInfo,
      credentials,
    });
    this.emit("connected");
    this.stateMachine.setState(ProtocolState.Ready);
  }

  async connect(options?: CompanionConnectionOptions): Promise<void> {
    try {
      await this.recoveryManager.runWithRecovery(
        () => this._connect(options?.authOptions, options?.transportOptions),
        {
          maxAttempts: 3,
          delay: 300,
        }
      );
    } catch (error) {
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
        "connect"
      );
      logger.error({ error }, "Failed to connect after recovery attempts");
      throw error;
    }
  }

  async disconnect(reason?: string): Promise<void> {
    if (
      this.state === ProtocolState.Idle ||
      this.state === ProtocolState.Disconnecting
    ) {
      logger.debug(
        { currentState: this.state },
        "Already idle or disconnecting, ignoring disconnect request"
      );
      return;
    }
    this.stateMachine.setState(ProtocolState.Disconnecting);
    await this.session.stop();
    this.encryption.disable();
    await this.transport.disconnect(reason);

    // Clean up all event listeners
    this.cleanupListeners();
    this.stateMachine.setState(ProtocolState.Idle);
  }

  private cleanupListeners(): void {
    this.session.removeAllListeners();
    this.hapFramedChannel.removeAllListeners();
    this.stateMachine.removeAllListeners();
    this.transport.removeAllListeners();
    this.removeAllListeners();
  }

  async sendCommandRaw<T extends CompanionCommand>(
    command: T
  ): Promise<CommandResponseOf<T>> {
    return this.session.sendCommandRaw(command);
  }
  async sendCommand<T extends CompanionCommand>(
    command: T
  ): Promise<CommandOutputOf<T>> {
    return this.session.sendCommand(command);
  }

  async subscribeToInterest(interests: CompanionEventTypes[]): Promise<void> {
    const event = createInterestEvent({ register: interests });
    // Send as event (unsolicited message)
    const data = event.build();
    logger.debug({ event: data }, "Subscribing to interest events");

    await this.session.sendMessage(data);
  }
}
