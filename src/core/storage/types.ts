/**
 * Storage system type definitions
 */
/**
 * Reworked Storage with CredentialStore support
 */

import type {
  BaseCredentials,
  CredentialStore,
} from "@/protocols/types/BaseProtocol.ts";
import type { ClientDeviceInfo } from "@/core/client-identity.ts";
import type { BaseAppleDevice } from "@/core/discovery/discovery-types.ts";

/**
 * Extended device information with storage metadata.
 * Extends BaseAppleDevice (not AppleDevice union) for identity fields.
 */
export interface StoredDevice extends BaseAppleDevice {
  /** When this device was first discovered (epoch ms) */
  firstSeen: number;
  /** User-friendly alias for the device */
  alias?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Global storage settings
 */
export interface StorageSettings {
  /** Global client device identity (BunATV's identity presented to Apple devices) */
  clientDeviceInfo?: ClientDeviceInfo;
  /** Other settings */
  [key: string]: unknown;
}

/**
 * Complete storage data structure
 */
export interface StorageData {
  /** Schema version for migrations */
  version: number;
  /** Map of device identifier to stored device */
  devices: Record<string, StoredDevice>;
  /** Map of composite key (deviceId:protocol) to pairing */
  credentials: Record<string, StoredCredentials>;
  /** Global settings */
  settings?: StorageSettings;
}

// ============================================================================
// Core Types
// ============================================================================

export type ProtocolType = "companion" | "airplay" | "raop" | "dmap" | "mrp";

/**
 * Generic stored credentials that extend BaseCredentials
 */
export interface StoredCredentials<
  T extends BaseCredentials = BaseCredentials,
> {
  /** Device identifier this belongs to */
  deviceId: string;
  /** Protocol type */
  protocol: ProtocolType;
  /** When created */
  createdAt: Date;
  /** When last updated */
  updatedAt: Date;
  /** When last used */
  lastUsed: Date;
  /** The actual credentials */
  credentials: T;
  /** Additional metadata (protocol-specific data like ClientDeviceInfo) */
  metadata?: Record<string, unknown>;
}

/**
 * Helper type for Companion protocol stored credentials with device info
 */
export interface CompanionStoredCredentials<
  T extends BaseCredentials = BaseCredentials,
> extends StoredCredentials<T> {
  metadata?: {
    /** Client device identity for system_info message */
    clientDeviceInfo?: {
      rpId: string;
      deviceId: string;
      model: string;
      name: string;
    };
    [key: string]: unknown;
  };
}

// ============================================================================
// CredentialStore Implementation
// ============================================================================

/**
 * Scoped credential store for a specific device and protocol
 * This implements the CredentialStore interface that orchestrators need
 */
export class ScopedCredentialStore<T extends BaseCredentials>
  implements CredentialStore<T>
{
  constructor(
    private storage: Storage,
    private deviceId: string,
    private protocol: ProtocolType
  ) {}

  async save(identifier: string, credentials: T): Promise<void> {
    const stored: StoredCredentials<T> = {
      deviceId: this.deviceId,
      protocol: this.protocol,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsed: new Date(),
      credentials,
      metadata: { identifier },
    };

    await this.storage.saveCredentials(this.deviceId, this.protocol, stored);
  }

  async load(identifier: string): Promise<T | undefined> {
    const stored = await this.storage.getCredentials<T>(
      this.deviceId,
      this.protocol
    );

    // Verify identifier matches if provided in metadata
    if (
      stored?.metadata?.identifier &&
      stored.metadata.identifier !== identifier
    ) {
      return undefined;
    }

    if (stored) {
      // Update last used
      await this.storage.updateLastUsed(this.deviceId, this.protocol);
      return stored.credentials;
    }

    return undefined;
  }

  async delete(identifier: string): Promise<void> {
    await this.storage.removeCredentials(this.deviceId, this.protocol);
  }
}

// ============================================================================
// Updated Storage Interface
// ============================================================================

export interface Storage {
  // Device operations (unchanged)
  getDevice(identifier: string): Promise<StoredDevice | null>;
  saveDevice(device: StoredDevice): Promise<void>;
  removeDevice(identifier: string): Promise<void>;
  listDevices(): Promise<StoredDevice[]>;

  // Credential operations (replaces pairing operations)
  getCredentials<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType
  ): Promise<StoredCredentials<T> | null>;

  saveCredentials<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType,
    credentials: StoredCredentials<T>
  ): Promise<void>;

  removeCredentials(deviceId: string, protocol: ProtocolType): Promise<void>;

  listCredentials(deviceId: string): Promise<StoredCredentials[]>;

  updateLastUsed(deviceId: string, protocol: ProtocolType): Promise<void>;

  // Get a credential store scoped to device/protocol
  getCredentialStore<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType
  ): CredentialStore<T>;

  // Client device identity methods
  /**
   * Get the global client device info (BunATV's identity)
   * Storage ensures this always exists - generates on first initialization
   * @returns The stored client device info
   */
  getClientDeviceInfo(): Promise<ClientDeviceInfo>;

  /**
   * Save the global client device info (BunATV's identity)
   * @param info - The client device info to save
   */
  saveClientDeviceInfo(info: ClientDeviceInfo): Promise<void>;

  // Data operations
  clear(): Promise<void>;
  export(): Promise<StorageData>;
  import(data: StorageData): Promise<void>;
}
