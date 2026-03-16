import type { AppleDevice } from "@/core/discovery/discovery-types.ts";

import type { Storage } from "@/core/storage/types.ts";
import { CredentialManager } from "@/cli/core/credential-manager.ts";
import { isRemoteControlSupported } from "@/core/utils/airplay-utils.ts";
import { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { Airplay2Protocol } from "@/protocols/airplay/layers/Airplay2Protocol.ts";
import { CompanionApi } from "@/protocols/companion/CompanionApi.ts";
import { MRPApi } from "@/protocols/mrp/MRPApi.ts";

export enum ProtocolType {
  Companion = "companion",
  MRP = "mrp",
  AirPlay = "airplay",
}

export interface DeviceConnectionOptions {
  companion?: Parameters<CompanionProtocol["connect"]>[0];
  airPlay?: Parameters<Airplay2Protocol["connect"]>[0];
  mrp?: Parameters<MRPProtocol["connect"]>[0];
}

export class DeviceApi {
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
  } = {
    [ProtocolType.Companion]: null,
    [ProtocolType.MRP]: null,
  };
  constructor(
    readonly device: AppleDevice,
    private readonly storage: Storage
  ) {
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

  async connect(options?: DeviceConnectionOptions): Promise<void> {
    await this._connectProtocols(options);
    await this._initializeApis();
  }

  /**
   * Disconnect all connected protocols in reverse dependency order.
   * Best-effort — logs errors per-protocol but does not throw.
   */
  async disconnect(reason?: string): Promise<void> {
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
    this.apis[ProtocolType.Companion] = null;
    this.apis[ProtocolType.MRP] = null;
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
  }
}
