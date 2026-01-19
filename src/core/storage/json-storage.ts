/**
 * JSON file-based storage implementation with CredentialStore support
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { BaseCredentials, CredentialStore } from '@/protocols/types/BaseProtocol.ts'
import type { ClientDeviceInfo } from '@/core/client-identity.ts'
import { createLogger } from '@/logging/logging'
import {
  type ProtocolType,
  ScopedCredentialStore,
  type StorageData,
  type StoredCredentials,
  type StoredDevice,
} from '@/core/storage/types.ts'
import type { Storage } from '@/core/storage/types.ts'
import { serializeBinary, deserializeBinary } from './binary-serializer'

const logger = createLogger("bunatv:storage:json");

export interface JsonStorageConfig {
  path?: string
  autoSave?: boolean
  prettyPrint?: boolean
}

// ============================================================================
// JSON Storage Implementation
// ============================================================================

export class JsonStorage implements Storage {
  private data: StorageData
  private readonly filePath: string
  private readonly autoSave: boolean
  private readonly prettyPrint: boolean
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor(config: JsonStorageConfig = {}) {
    this.filePath = config.path ?? join(homedir(), '.config', 'bunatv.json')
    this.autoSave = config.autoSave ?? true
    this.prettyPrint = config.prettyPrint ?? true

    // Initialize with empty data
    this.data = {
      version: 1,
      devices: {},
      credentials: {}, // Changed from pairings
      settings: {},
    }

    // Start initialization
    this.initPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    await this.loadData()
    await this.ensureClientDeviceInfoExists()
    this.initialized = true
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initPromise) {
      await this.initPromise
    }
  }

  private async loadData(): Promise<void> {
    if (!existsSync(this.filePath)) {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      await this.saveData()
      return
    }

    try {
      const file = Bun.file(this.filePath)
      const text = await file.text()

      if (text.trim()) {
        const parsed = JSON.parse(text)

        // Handle migration from old "pairings" to new "credentials"
        if (parsed.pairings && !parsed.credentials) {
          parsed.credentials = parsed.pairings
          delete parsed.pairings
        }

        // Deserialize binary data from base64 strings
        this.data = deserializeBinary(parsed)
        this.data.devices = this.data.devices || {}
        this.data.credentials = this.data.credentials || {}
        this.data.settings = this.data.settings || {}
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load storage data')
    }
  }

  private async saveData(): Promise<void> {
    try {
      // Serialize binary data to base64 strings before JSON.stringify
      const serialized = serializeBinary(this.data)
      const json = this.prettyPrint
        ? JSON.stringify(serialized, null, 2)
        : JSON.stringify(serialized)

      await Bun.write(this.filePath, json)
    } catch (error) {
      logger.error({ error }, 'Failed to save storage data')
      throw error
    }
  }

  private async autoSaveIfEnabled(): Promise<void> {
    if (this.autoSave) {
      await this.saveData()
    }
  }

  private credentialKey(deviceId: string, protocol: ProtocolType): string {
    return `${deviceId}:${protocol}`
  }

  // Device operations
  async getDevice(identifier: string): Promise<StoredDevice | null> {
    await this.ensureInitialized()
    return this.data.devices[identifier] || null
  }

  async saveDevice(device: StoredDevice): Promise<void> {
    await this.ensureInitialized()
    this.data.devices[device.identifier] = device
    await this.autoSaveIfEnabled()
  }

  async removeDevice(identifier: string): Promise<void> {
    await this.ensureInitialized()
    delete this.data.devices[identifier]

    // Remove all credentials for this device
    Object.keys(this.data.credentials).forEach(key => {
      if (key.startsWith(`${identifier}:`)) {
        delete this.data.credentials[key]
      }
    })

    await this.autoSaveIfEnabled()
  }

  async listDevices(): Promise<StoredDevice[]> {
    await this.ensureInitialized()
    return Object.values(this.data.devices)
  }

  // Credential operations
  async getCredentials<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType
  ): Promise<StoredCredentials<T> | null> {
    await this.ensureInitialized()
    const key = this.credentialKey(deviceId, protocol)
    return (this.data.credentials[key] as StoredCredentials<T>) || null
  }

  async saveCredentials<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType,
    credentials: StoredCredentials<T>
  ): Promise<void> {
    await this.ensureInitialized()
    const key = this.credentialKey(deviceId, protocol)
    this.data.credentials[key] = credentials as StoredCredentials
    await this.autoSaveIfEnabled()
  }

  async removeCredentials(deviceId: string, protocol: ProtocolType): Promise<void> {
    await this.ensureInitialized()
    const key = this.credentialKey(deviceId, protocol)
    delete this.data.credentials[key]
    await this.autoSaveIfEnabled()
  }

  async listCredentials(deviceId: string): Promise<StoredCredentials[]> {
    await this.ensureInitialized()
    const credentials: StoredCredentials[] = []
    const prefix = `${deviceId}:`

    Object.entries(this.data.credentials).forEach(([key, cred]) => {
      if (key.startsWith(prefix)) {
        credentials.push(cred)
      }
    })

    return credentials
  }

  async updateLastUsed(deviceId: string, protocol: ProtocolType): Promise<void> {
    await this.ensureInitialized()
    const key = this.credentialKey(deviceId, protocol)
    const cred = this.data.credentials[key]

    if (cred) {
      cred.lastUsed = new Date()
      await this.autoSaveIfEnabled()
    }
  }

  // Get scoped credential store
  getCredentialStore<T extends BaseCredentials>(
    deviceId: string,
    protocol: ProtocolType
  ): CredentialStore<T> {
    return new ScopedCredentialStore<T>(this, deviceId, protocol)
  }

  /**
   * Ensure client device info exists during initialization
   * Called automatically - protocols don't need to worry about this
   */
  private async ensureClientDeviceInfoExists(): Promise<void> {
    if (this.data.settings?.clientDeviceInfo) {
      logger.debug('Client device info already exists')
      return
    }

    logger.info('No client device info found, generating new identity')
    const { generateClientDeviceInfo } = await import('@/core/client-identity.ts')
    const info = generateClientDeviceInfo()

    if (!this.data.settings) {
      this.data.settings = {}
    }
    this.data.settings.clientDeviceInfo = info
    await this.saveData()

    logger.info({ info }, 'Generated and saved new client device identity')
  }

  // Client device identity methods
  async getClientDeviceInfo(): Promise<ClientDeviceInfo> {
    await this.ensureInitialized()
    const info = this.data.settings?.clientDeviceInfo
    if (!info) {
      throw new Error('Client device info not initialized - this should never happen')
    }
    return info
  }

  async saveClientDeviceInfo(info: ClientDeviceInfo): Promise<void> {
    await this.ensureInitialized()
    if (!this.data.settings) {
      this.data.settings = {}
    }
    this.data.settings.clientDeviceInfo = info
    await this.saveData()
  }

  // Data operations
  async clear(): Promise<void> {
    await this.ensureInitialized()
    this.data = {
      version: 1,
      devices: {},
      credentials: {},
      settings: {},
    }
    await this.saveData()
  }

  async export(): Promise<StorageData> {
    await this.ensureInitialized()
    // Return a deep copy with binary data properly serialized
    const serialized = serializeBinary(this.data)
    return JSON.parse(JSON.stringify(serialized))
  }

  async import(data: StorageData): Promise<void> {
    await this.ensureInitialized()

    // Deserialize binary data if it's in serialized form
    this.data = deserializeBinary(data)
    this.data.devices = this.data.devices || {}
    this.data.credentials = this.data.credentials || {}
    this.data.settings = this.data.settings || {}

    await this.saveData()
  }

  async flush(): Promise<void> {
    await this.saveData()
  }
}
