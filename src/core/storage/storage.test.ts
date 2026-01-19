/**
 * Storage system tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync, existsSync } from 'node:fs'
import { JsonStorage } from './json-storage'
import type { StoredDevice, StoredCredentials } from './types'
import type { HAPCredentials } from '@/protocols/companion/layers/HAPAuthenticationService'

describe('JsonStorage', () => {
  let storage: JsonStorage
  let tempPath: string

  beforeEach(() => {
    // Use temp file for testing
    tempPath = join(tmpdir(), `bunatv-test-${Date.now()}.json`)
    storage = new JsonStorage({ path: tempPath, autoSave: true })
  })

  afterEach(() => {
    // Clean up temp file
    if (existsSync(tempPath)) {
      rmSync(tempPath)
    }
  })

  describe('Device operations', () => {
    const testDevice: StoredDevice = {
      name: 'Test Apple TV',
      identifier: 'test-device-123',
      deviceId: 'ABC123',
      address: '192.168.1.100',
      port: 7000,
      protocols: ['companion', 'airplay'],
      model: 'Apple TV 4K',
      osVersion: '17.0',
      manufacturer: 'Apple',
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    }

    it('should save and retrieve a device', async () => {
      await storage.saveDevice(testDevice)
      const retrieved = await storage.getDevice(testDevice.identifier)

      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe(testDevice.name)
      expect(retrieved?.identifier).toBe(testDevice.identifier)
      expect(retrieved?.protocols).toEqual(testDevice.protocols)
    })

    it('should update existing device', async () => {
      await storage.saveDevice(testDevice)

      const updated = { ...testDevice, name: 'Updated Apple TV' }
      await storage.saveDevice(updated)

      const retrieved = await storage.getDevice(testDevice.identifier)
      expect(retrieved?.name).toBe('Updated Apple TV')
    })

    it('should list all devices', async () => {
      const device2 = { ...testDevice, identifier: 'test-device-456', name: 'Second TV' }

      await storage.saveDevice(testDevice)
      await storage.saveDevice(device2)

      const devices = await storage.listDevices()
      expect(devices).toHaveLength(2)
      expect(devices.map(d => d.identifier).sort()).toEqual(['test-device-123', 'test-device-456'])
    })

    it('should remove device and associated pairings', async () => {
      await storage.saveDevice(testDevice)

      // Add credentials
      const hapCredentials: HAPCredentials = {
        identifier: 'test-client-id',
        clientId: 'test-client-id',
        publicKey: new Uint8Array([1, 2, 3, 4, 5]),
        privateKey: new Uint8Array([6, 7, 8, 9, 10]),
        accessoryPublicKey: new Uint8Array([11, 12, 13, 14, 15]),
      }

      const storedCredentials: StoredCredentials<HAPCredentials> = {
        deviceId: testDevice.identifier,
        protocol: 'companion',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: new Date(),
        credentials: hapCredentials,
        metadata: { identifier: hapCredentials.identifier },
      }

      await storage.saveCredentials(testDevice.identifier, 'companion', storedCredentials)

      // Remove device
      await storage.removeDevice(testDevice.identifier)

      // Check device is gone
      const device = await storage.getDevice(testDevice.identifier)
      expect(device).toBeNull()

      // Check credentials are gone
      const retrievedCredentials = await storage.getCredentials(testDevice.identifier, 'companion')
      expect(retrievedCredentials).toBeNull()
    })
  })

  describe('Credential operations', () => {
    const hapCredentials: HAPCredentials = {
      identifier: 'test-client-uuid',
      clientId: 'test-client-uuid',
      publicKey: new Uint8Array([10, 20, 30, 40, 50]),
      privateKey: new Uint8Array([60, 70, 80, 90, 100]),
      accessoryPublicKey: new Uint8Array([110, 120, 130, 140, 150]),
    }

    const testCredentials: StoredCredentials<HAPCredentials> = {
      deviceId: 'test-device-123',
      protocol: 'companion',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsed: new Date(),
      credentials: hapCredentials,
      metadata: { identifier: hapCredentials.identifier },
    }

    it('should save and retrieve credentials', async () => {
      await storage.saveCredentials(
        testCredentials.deviceId,
        testCredentials.protocol,
        testCredentials
      )
      const retrieved = await storage.getCredentials<HAPCredentials>(
        testCredentials.deviceId,
        testCredentials.protocol
      )

      expect(retrieved).toBeDefined()
      expect(retrieved?.deviceId).toBe(testCredentials.deviceId)
      expect(retrieved?.protocol).toBe(testCredentials.protocol)
      expect(retrieved?.credentials.identifier).toBe(testCredentials.credentials.identifier)
    })

    it('should list credentials for a device', async () => {
      const airplayCredentials = { ...testCredentials, protocol: 'airplay' as const }

      await storage.saveCredentials(
        testCredentials.deviceId,
        testCredentials.protocol,
        testCredentials
      )
      await storage.saveCredentials(
        airplayCredentials.deviceId,
        airplayCredentials.protocol,
        airplayCredentials
      )

      const credentials = await storage.listCredentials(testCredentials.deviceId)
      expect(credentials).toHaveLength(2)
      expect(credentials.map(c => c.protocol).sort()).toEqual(['airplay', 'companion'])
    })

    it('should remove specific credentials', async () => {
      const airplayCredentials = { ...testCredentials, protocol: 'airplay' as const }

      await storage.saveCredentials(
        testCredentials.deviceId,
        testCredentials.protocol,
        testCredentials
      )
      await storage.saveCredentials(
        airplayCredentials.deviceId,
        airplayCredentials.protocol,
        airplayCredentials
      )

      await storage.removeCredentials(testCredentials.deviceId, 'companion')

      const companion = await storage.getCredentials(testCredentials.deviceId, 'companion')
      expect(companion).toBeNull()

      const airplay = await storage.getCredentials(airplayCredentials.deviceId, 'airplay')
      expect(airplay).toBeDefined()
    })
  })

  describe('Binary data persistence', () => {
    it('should properly serialize and deserialize HAP credentials with binary keys', async () => {
      const hapCredentials: HAPCredentials = {
        identifier: 'binary-test-client',
        clientId: 'binary-test-client',
        // Test with real crypto key sizes and various byte values
        publicKey: new Uint8Array([
          255, 0, 128, 64, 32, 16, 8, 4, 2, 1, 127, 192, 96, 48, 24, 12, 6, 3, 129, 195, 225, 240,
          248, 252, 254, 63, 31, 15, 7, 135, 207, 239,
        ]),
        privateKey: new Uint8Array([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
          26, 27, 28, 29, 30, 31, 32,
        ]),
        accessoryPublicKey: new Uint8Array([
          32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11,
          10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
        ]),
      }

      const storedCredentials: StoredCredentials<HAPCredentials> = {
        deviceId: 'binary-test-device',
        protocol: 'companion',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: new Date(),
        credentials: hapCredentials,
        metadata: { identifier: hapCredentials.identifier },
      }

      // Save credentials
      await storage.saveCredentials(
        storedCredentials.deviceId,
        storedCredentials.protocol,
        storedCredentials
      )

      // Create new storage instance to test file persistence
      const storage2 = new JsonStorage({ path: tempPath })
      const retrieved = await storage2.getCredentials<HAPCredentials>(
        storedCredentials.deviceId,
        storedCredentials.protocol
      )

      expect(retrieved).toBeDefined()
      expect(retrieved?.credentials).toBeDefined()

      // Verify binary keys are properly restored
      expect(retrieved!.credentials.publicKey).toBeInstanceOf(Uint8Array)
      expect(retrieved!.credentials.privateKey).toBeInstanceOf(Uint8Array)
      expect(retrieved!.credentials.accessoryPublicKey).toBeInstanceOf(Uint8Array)

      // Verify exact byte values
      expect(Array.from(retrieved!.credentials.publicKey)).toEqual(
        Array.from(hapCredentials.publicKey)
      )
      expect(Array.from(retrieved!.credentials.privateKey)).toEqual(
        Array.from(hapCredentials.privateKey)
      )
      expect(Array.from(retrieved!.credentials.accessoryPublicKey)).toEqual(
        Array.from(hapCredentials.accessoryPublicKey)
      )

      // Verify other fields
      expect(retrieved!.credentials.identifier).toBe(hapCredentials.identifier)
      expect(retrieved!.credentials.clientId).toBe(hapCredentials.clientId)
    })

    it('should handle mixed buffer types in credentials', async () => {
      const mixedCredentials = {
        identifier: 'mixed-buffer-test',
        clientId: 'mixed-buffer-test',
        publicKey: Buffer.from([1, 2, 3, 4, 5]), // Node Buffer
        privateKey: new Uint8Array([6, 7, 8, 9, 10]), // Uint8Array
        accessoryPublicKey: new ArrayBuffer(5), // ArrayBuffer
      } as any

      // Set data in ArrayBuffer
      const view = new Uint8Array(mixedCredentials.accessoryPublicKey)
      view.set([11, 12, 13, 14, 15])

      const storedCredentials: StoredCredentials = {
        deviceId: 'mixed-buffer-device',
        protocol: 'companion',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: new Date(),
        credentials: mixedCredentials,
        metadata: { identifier: mixedCredentials.identifier },
      }

      await storage.saveCredentials(
        storedCredentials.deviceId,
        storedCredentials.protocol,
        storedCredentials
      )
      const retrieved: StoredCredentials<HAPCredentials> | null = await storage.getCredentials(
        storedCredentials.deviceId,
        storedCredentials.protocol
      )

      expect(retrieved).toBeDefined()

      // Verify types are preserved
      expect(Buffer.isBuffer(retrieved!.credentials.publicKey)).toBe(true)
      expect(retrieved!.credentials.privateKey).toBeInstanceOf(Uint8Array)
      expect(retrieved!.credentials.accessoryPublicKey).toBeInstanceOf(ArrayBuffer)

      // Verify data integrity
      expect(Array.from(retrieved!.credentials.publicKey)).toEqual([1, 2, 3, 4, 5])
      expect(Array.from(retrieved!.credentials.privateKey)).toEqual([6, 7, 8, 9, 10])
      expect(Array.from(new Uint8Array(retrieved!.credentials.accessoryPublicKey))).toEqual([
        11, 12, 13, 14, 15,
      ])
    })

    it('should produce human-readable JSON files with base64 encoding', async () => {
      const credentials = {
        identifier: 'json-readable-test',
        clientId: 'json-readable-test',
        publicKey: Buffer.from('Hello, World!', 'utf8'),
        privateKey: new Uint8Array([1, 2, 3, 4, 5]),
        accessoryPublicKey: new Uint8Array([255, 254, 253]),
      } as any

      const stored: StoredCredentials = {
        deviceId: 'json-readable-device',
        protocol: 'companion',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: new Date(),
        credentials,
        metadata: { identifier: credentials.identifier },
      }

      await storage.saveCredentials(stored.deviceId, stored.protocol, stored)
      await storage.flush()

      // Read the actual JSON file
      const fileContent = await Bun.file(tempPath).text()

      // Should contain binary markers
      expect(fileContent).toContain('"__binary": true')
      expect(fileContent).toContain('"type": "Buffer"')
      expect(fileContent).toContain('"type": "Uint8Array"')

      // Should contain base64 data
      expect(fileContent).toContain('SGVsbG8sIFdvcmxkIQ==') // 'Hello, World!' in base64
      expect(fileContent).toContain('AQIDBAU=') // [1,2,3,4,5] in base64
      expect(fileContent).toContain('//79') // [255,254,253] in base64

      // Should be parseable JSON
      const parsedJson = JSON.parse(fileContent)
      expect(parsedJson).toBeDefined()
      expect(parsedJson.version).toBe(1)
    })
  })

  describe('Data persistence', () => {
    it('should persist data across instances', async () => {
      const device: StoredDevice = {
        name: 'Persistent TV',
        identifier: 'persist-123',
        deviceId: 'XYZ789',
        address: '192.168.1.200',
        port: 7000,
        protocols: ['mrp'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      }

      await storage.saveDevice(device)

      // Create new instance with same file
      const storage2 = new JsonStorage({ path: tempPath })
      const retrieved = await storage2.getDevice(device.identifier)

      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe(device.name)
    })

    it('should handle corrupted file gracefully', async () => {
      // Write invalid JSON to file
      await Bun.write(tempPath, '{ invalid json }')

      // Should not throw, should start with empty data
      const storage2 = new JsonStorage({ path: tempPath })
      const devices = await storage2.listDevices()
      expect(devices).toEqual([])
    })
  })

  describe('Import/Export', () => {
    it('should export and import data', async () => {
      const device: StoredDevice = {
        name: 'Export TV',
        identifier: 'export-123',
        deviceId: 'EXP123',
        address: '192.168.1.150',
        port: 7000,
        protocols: ['companion'],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      }

      await storage.saveDevice(device)

      // Export data
      const exported = await storage.export()

      // Clear storage
      await storage.clear()
      const devices = await storage.listDevices()
      expect(devices).toEqual([])

      // Import data
      await storage.import(exported)

      // Check device is restored
      const retrieved = await storage.getDevice(device.identifier)
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe(device.name)
    })
  })
})
