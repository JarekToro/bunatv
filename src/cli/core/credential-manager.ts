import type { Storage } from '@/core/storage/types.ts'
import type { HAPCredentials } from '@/protocols/companion/layers/HAPAuthenticationService.ts'

export class CredentialManager {
  constructor(private storage: Storage) {}

  /**
   * Check if credentials exist for a device
   */
  async hasCredentials(identifier: string): Promise<boolean> {
    try {
      const store = this.storage.getCredentialStore<HAPCredentials>(identifier, 'companion')
      const credentials = await store.load(identifier)
      return credentials !== undefined
    } catch {
      return false
    }
  }

  /**
   * Load credentials for a device
   */
  async loadCredentials(identifier: string): Promise<HAPCredentials | undefined> {
    try {
      const store = this.storage.getCredentialStore<HAPCredentials>(identifier, 'companion')
      return await store.load(identifier)
    } catch {
      return undefined
    }
  }

  /**
   * Save credentials (typically done by protocol, but available for manual use)
   */
  async saveCredentials(identifier: string, credentials: HAPCredentials): Promise<void> {
    const store = this.storage.getCredentialStore<HAPCredentials>(identifier, 'companion')
    await store.save(identifier, credentials)
  }

  /**
   * Delete credentials (for re-pairing)
   */
  async deleteCredentials(identifier: string): Promise<void> {
    const store = this.storage.getCredentialStore<HAPCredentials>(identifier, 'companion')
    await store.delete(identifier)
  }

  /**
   * List all paired devices
   */
  async listPairedDevices(): Promise<string[]> {
    // TODO: Implement based on storage structure
    // This requires the storage to expose a method to list all stored identifiers
    throw new Error('Not yet implemented')
  }

  /**
   * Get pairing information for a device
   */
  async getPairingInfo(identifier: string): Promise<
    | {
        identifier: string
        protocol: string
        pairedAt?: Date
      }
    | undefined
  > {
    const credentials = await this.loadCredentials(identifier)
    if (!credentials) return undefined

    return {
      identifier,
      protocol: 'companion',
      // TODO: Add timestamp to credentials when saved
      pairedAt: undefined,
    }
  }
}
