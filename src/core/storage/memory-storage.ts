// ============================================================================
// Memory Storage Implementation
// ============================================================================

import {
  type ProtocolType,
  ScopedCredentialStore,
  type StorageData,
  type StoredCredentials,
  type StoredDevice,
} from "@/core/storage/types.ts";
import type {
  BaseCredentials,
  CredentialStore,
} from "@/protocols/types/BaseProtocol.ts";
import type { Storage } from "@/core/storage/types";
import type { ClientDeviceInfo } from "@/core/client-identity.ts";

export class MemoryStorage implements Storage {
  private data: StorageData;
  private snapshots: Map<string, StorageData> = new Map();

  constructor(initialData?: StorageData) {
    this.data = initialData || {
      version: 1,
      devices: {},
      credentials: {},
      settings: {},
    };

    // Ensure client device info exists
    this.ensureClientDeviceInfoExists();
  }

  /**
   * Ensure client device info exists during initialization
   */
  private ensureClientDeviceInfoExists(): void {
    if (this.data.settings?.clientDeviceInfo) {
      return;
    }

    // Generate synchronously for memory storage
    const { generateClientDeviceInfo } = require("@/core/client-identity.ts");
    const info = generateClientDeviceInfo();

    if (!this.data.settings) {
      this.data.settings = {};
    }
    this.data.settings.clientDeviceInfo = info;
  }

  private credentialKey(deviceId: string, protocol: ProtocolType): string {
    return `${deviceId}:${protocol}`;
  }

  private cloneData(): StorageData {
    return JSON.parse(JSON.stringify(this.data));
  }

  // Device operations
  async getDevice(identifier: string): Promise<StoredDevice | null> {
    return this.data.devices[identifier] || null;
  }

  async saveDevice(device: StoredDevice): Promise<void> {
    this.data.devices[device.identifier] = device;
  }

  async removeDevice(identifier: string): Promise<void> {
    delete this.data.devices[identifier];

    // Remove all credentials for this device
    Object.keys(this.data.credentials).forEach((key) => {
      if (key.startsWith(`${identifier}:`)) {
        delete this.data.credentials[key];
      }
    });
  }

  async listDevices(): Promise<StoredDevice[]> {
    return Object.values(this.data.devices);
  }

  // Credential operations
  async getCredentials<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType
  ): Promise<StoredCredentials<T> | null> {
    const key = this.credentialKey(deviceId, protocol);
    return (this.data.credentials[key] as StoredCredentials<T>) || null;
  }

  async saveCredentials<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType,
    credentials: StoredCredentials<T>
  ): Promise<void> {
    const key = this.credentialKey(deviceId, protocol);
    this.data.credentials[key] = credentials as StoredCredentials;
  }

  async removeCredentials(
    deviceId: string,
    protocol: ProtocolType
  ): Promise<void> {
    const key = this.credentialKey(deviceId, protocol);
    delete this.data.credentials[key];
  }

  async listCredentials(deviceId: string): Promise<StoredCredentials[]> {
    const credentials: StoredCredentials[] = [];
    const prefix = `${deviceId}:`;

    Object.entries(this.data.credentials).forEach(([key, cred]) => {
      if (key.startsWith(prefix)) {
        credentials.push(cred);
      }
    });

    return credentials;
  }

  async updateLastUsed(
    deviceId: string,
    protocol: ProtocolType
  ): Promise<void> {
    const key = this.credentialKey(deviceId, protocol);
    const cred = this.data.credentials[key];

    if (cred) {
      cred.lastUsed = new Date();
    }
  }

  // Get scoped credential store
  getCredentialStore<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType
  ): CredentialStore<T> {
    return new ScopedCredentialStore<T>(this, deviceId, protocol);
  }

  // Client device identity methods
  async getClientDeviceInfo(): Promise<ClientDeviceInfo> {
    const info = this.data.settings?.clientDeviceInfo;
    if (!info) {
      throw new Error(
        "Client device info not initialized - this should never happen"
      );
    }
    return info;
  }

  async saveClientDeviceInfo(info: ClientDeviceInfo): Promise<void> {
    if (!this.data.settings) {
      this.data.settings = {};
    }
    this.data.settings.clientDeviceInfo = info;
  }

  // Data operations
  async clear(): Promise<void> {
    this.data = {
      version: 1,
      devices: {},
      credentials: {},
      settings: {},
    };
  }

  async export(): Promise<StorageData> {
    return this.cloneData();
  }

  async import(data: StorageData): Promise<void> {
    this.data = { ...data };
  }

  async flush(): Promise<void> {
    // No-op for memory storage
  }
}
