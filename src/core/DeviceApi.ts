import type { AppleDevice } from "@/core/discovery/discovery-types.ts";
import { EventEmitter } from "eventemitter3";

import type { Storage } from "@/core/storage/types.ts";
import { CredentialManager } from "@/cli/core/credential-manager.ts";
import { isRemoteControlSupported } from "@/core/utils/airplay-utils.ts";
import { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { Airplay2Protocol } from "@/protocols/airplay/layers/Airplay2Protocol.ts";
import { CompanionApi } from "@/protocols/companion/CompanionApi.ts";
import { MRPApi } from "@/protocols/mrp/MRPApi.ts";
import { RaopApi } from "@/protocols/raop/RaopApi.ts";
import { ProtocolState } from "@/protocols/types/BaseProtocol.ts";

export enum ProtocolType {
  Companion = "companion",
  MRP = "mrp",
  AirPlay = "airplay",
  RAOP = "raop",
}

export interface DeviceConnectionOptions {
  companion?: Parameters<CompanionProtocol["connect"]>[0];
  airPlay?: Parameters<Airplay2Protocol["connect"]>[0];
  mrp?: Parameters<MRPProtocol["connect"]>[0];
}

export interface DeviceApiEvents {
  /** Emitted when a protocol fails unexpectedly (device-initiated disconnect) */
  "connection-lost": (protocol: ProtocolType, error: Error) => void;
  /** Emitted on protocol errors */
  error: (error: Error, context?: string) => void;
}

export class DeviceApi extends EventEmitter<DeviceApiEvents> {
  private credentialManager: CredentialManager;
  private protocols: {
    [ProtocolType.Companion]: CompanionProtocol | null;
    [ProtocolType.MRP]: MRPProtocol | null;
    [ProtocolType.AirPlay]: Airplay2Protocol | null;
  } = {
    [ProtocolType.Companion]: null,
    [ProtocolType.MRP]: null,
    [ProtocolType.AirPlay]: null,
  };
  private apis: {
    [ProtocolType.Companion]: CompanionApi | null;
    [ProtocolType.MRP]: MRPApi | null;
    [ProtocolType.RAOP]: RaopApi | null;
  } = {
    [ProtocolType.Companion]: null,
    [ProtocolType.MRP]: null,
    [ProtocolType.RAOP]: null,
  };

  constructor(
    readonly device: AppleDevice,
    private readonly storage: Storage
  ) {
    super();
    this.credentialManager = new CredentialManager(this.storage);
  }

  /**
   * Check if the device has stored credentials for a given protocol
   */
  async isPaired(protocol: ProtocolType): Promise<boolean> {
    return this.credentialManager.hasCredentials(
      this.device.identifier,
      protocol
    );
  }

  /**
   * Check if the device advertises support for a given protocol
   */
  hasProtocol(protocol: ProtocolType): boolean {
    return this.supportsProtocol(protocol);
  }

  private supportsProtocol(protocol: ProtocolType): boolean {
    switch (protocol) {
      case ProtocolType.Companion:
        return this.device.services.companionLink !== undefined;
      case ProtocolType.MRP:
        return (
          this.device.services.airPlay !== undefined &&
          isRemoteControlSupported(this.device.services.airPlay)
        );
      case ProtocolType.AirPlay:
        return this.device.services.airPlay !== undefined;
      case ProtocolType.RAOP:
        return this.device.services.raop !== undefined;
      default:
        return false;
    }
  }

  mrp(): MRPApi {
    if (!this.apis[ProtocolType.MRP]) {
      throw new Error("MRP protocol not initialized");
    }
    return this.apis[ProtocolType.MRP]!;
  }
  companion(): CompanionApi {
    if (!this.apis[ProtocolType.Companion]) {
      throw new Error("Companion protocol not initialized");
    }
    return this.apis[ProtocolType.Companion]!;
  }

  raop(): RaopApi {
    if (!this.apis[ProtocolType.RAOP]) {
      throw new Error("RAOP protocol not initialized");
    }
    return this.apis[ProtocolType.RAOP]!;
  }

  async connect(options?: DeviceConnectionOptions): Promise<void> {
    await this._connectProtocols(options);
    this._setupProtocolListeners();
    await this._initializeApis();
  }

  /**
   * Disconnect all connected protocols in reverse dependency order.
   * Best-effort — logs errors per-protocol but does not throw.
   */
  async disconnect(reason?: string): Promise<void> {
    // Clean up API layers first (remove their listeners from protocols)
    this.apis[ProtocolType.MRP]?.disconnect();
    this.apis[ProtocolType.Companion]?.cleanup();
    this.apis[ProtocolType.Companion] = null;
    this.apis[ProtocolType.MRP] = null;

    // Disconnect protocols in reverse dependency order
    const order = [
      ProtocolType.MRP,
      ProtocolType.AirPlay,
      ProtocolType.Companion,
    ] as const;
    for (const type of order) {
      const protocol = this.protocols[type];
      if (protocol) {
        try {
          await protocol.disconnect(reason);
        } catch (error) {
          console.error(
            `Disconnect warning (${type}):`,
            (error as Error).message
          );
        }
        this.protocols[type] = null;
      }
    }
  }

  private async _connectProtocols(
    options?: DeviceConnectionOptions
  ): Promise<void> {
    if (this.supportsProtocol(ProtocolType.Companion)) {
      this.protocols[ProtocolType.Companion] = await CompanionProtocol.create(
        this.device,
        this.storage
      );
      await this.protocols[ProtocolType.Companion].connect(options?.companion);
    }
    if (this.supportsProtocol(ProtocolType.AirPlay)) {
      this.protocols[ProtocolType.AirPlay] = await Airplay2Protocol.create(
        this.device,
        this.storage
      );
      await this.protocols[ProtocolType.AirPlay].connect(options?.airPlay);
    }
    if (this.supportsProtocol(ProtocolType.MRP)) {
      const airPlayProtocol = this.protocols[ProtocolType.AirPlay];
      if (!airPlayProtocol) {
        throw new Error("AirPlay protocol is required for MRP");
      }
      this.protocols[ProtocolType.MRP] = await MRPProtocol.create(
        airPlayProtocol,
        this.storage
      );
      await this.protocols[ProtocolType.MRP].connect(options?.mrp);
    }
  }

  /**
   * Listen for protocol state changes to detect unexpected disconnections.
   * When a protocol transitions to Failed, emit "connection-lost" so
   * the consumer can decide whether to reconnect.
   */
  private _setupProtocolListeners(): void {
    const onStateChanged = (type: ProtocolType) => {
      return (newState: ProtocolState) => {
        if (newState === ProtocolState.Failed) {
          this.emit(
            "connection-lost",
            type,
            new Error(`Protocol ${type} failed unexpectedly`)
          );
        }
      };
    };

    const onError = (type: ProtocolType) => {
      return (error: Error, context?: string) => {
        this.emit("error", error, `${type}:${context ?? "unknown"}`);
      };
    };

    const companion = this.protocols[ProtocolType.Companion];
    if (companion) {
      companion.on("state-changed", onStateChanged(ProtocolType.Companion));
      companion.on("error", onError(ProtocolType.Companion));
    }

    const airPlay = this.protocols[ProtocolType.AirPlay];
    if (airPlay) {
      airPlay.on("state-changed", onStateChanged(ProtocolType.AirPlay));
      airPlay.on("error", onError(ProtocolType.AirPlay));
    }

    const mrp = this.protocols[ProtocolType.MRP];
    if (mrp) {
      mrp.on("state-changed", onStateChanged(ProtocolType.MRP));
      mrp.on("error", onError(ProtocolType.MRP));
    }
  }

  private async _initializeApis(): Promise<void> {
    const clientDeviceInfo = await this.storage.getClientDeviceInfo();
    if (this.protocols[ProtocolType.Companion]) {
      this.apis[ProtocolType.Companion] = new CompanionApi(
        this.protocols[ProtocolType.Companion]!,
        clientDeviceInfo
      );
    }
    if (this.protocols[ProtocolType.MRP]) {
      this.apis[ProtocolType.MRP] = new MRPApi(
        this.protocols[ProtocolType.MRP]!
      );
    }
    if (this.supportsProtocol(ProtocolType.RAOP)) {
      const service = this.device.services.raop!;
      this.apis[ProtocolType.RAOP] = new RaopApi(service);
    }
  }
}
