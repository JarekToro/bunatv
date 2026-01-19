import { AppleTVDiscoveryService } from '@/core/discovery/apple-device-discovery.ts'
import type { DiscoveredDevice, AppleDevice } from '@/core/discovery/discovery-types.ts'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export class DeviceNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Device not found: ${identifier}`)
    this.name = 'DeviceNotFoundError'
  }
}

export class NoDevicesFoundError extends Error {
  constructor() {
    super('No Apple TV devices found on network')
    this.name = 'NoDevicesFoundError'
  }
}

export class DeviceManager {
  private discovery: AppleTVDiscoveryService

  constructor() {
    this.discovery = new AppleTVDiscoveryService()
  }

  /**
   * Discover all Apple TV devices on the network
   */
  async discover(timeoutSeconds: number = 5): Promise<DiscoveredDevice[]> {
    try {
      // Use AppleTVDiscoveryService to discover devices
      // It handles caching and network discovery automatically
      const appleDevices = await this.discovery.discover(timeoutSeconds * 1000)

      // Map to DiscoveredDevice format
      return appleDevices.map(device => this.mapToDiscoveredDevice(device))
    } catch (error) {
      throw new Error(`Discovery failed: ${(error as Error).message}`)
    }
  }

  /**
   * Find a specific device by identifier (ID, IP, or name)
   */
  async findDevice(identifier: string): Promise<DiscoveredDevice> {
    // Try to find by name first
    let device = await this.discovery.getAppleDevice(identifier)

    // If not found, try by hostname
    if (!device) {
      device = await this.discovery.getAppleDeviceByHostname(identifier)
    }

    // If still not found, search all devices for matching IP or ID
    if (!device) {
      const allDevices = await this.discovery.getAllAppleDevices()
      device =
        allDevices.find(d => {
          const ipMatch = d.ipv4.includes(identifier) || d.ipv6.includes(identifier)
          const idMatch = d.services.airplay?.txt.deviceid === identifier
          return ipMatch || idMatch
        }) || null
    }

    if (!device) {
      throw new DeviceNotFoundError(identifier)
    }

    return this.mapToDiscoveredDevice(device)
  }

  /**
   * Filter devices by protocol capability
   */
  filterByProtocol(
    devices: DiscoveredDevice[],
    protocol: 'airplay' | 'companion' | 'raop'
  ): DiscoveredDevice[] {
    return devices.filter(device => device.protocols.includes(protocol))
  }

  /**
   * Check if a device supports a specific protocol
   */
  supportsProtocol(device: DiscoveredDevice, protocol: 'airplay' | 'companion' | 'raop'): boolean {
    return device.protocols.includes(protocol)
  }

  /**
   * Map AppleDevice to DiscoveredDevice
   */
  private mapToDiscoveredDevice(device: AppleDevice): DiscoveredDevice {
    const airplay = device.services.airplay
    const companion = device.services.companionLink
    const raop = device.services.raop

    const protocols: string[] = []
    if (airplay) protocols.push('airplay')
    if (companion) protocols.push('companion')
    if (raop) protocols.push('raop')

    const deviceId = airplay?.txt.deviceid || 'unknown'

    return {
      name: device.name,
      identifier: deviceId,
      macAddress: deviceId,
      deviceId: deviceId,
      address: device.ipv4[0] || device.ipv6[0] || 'unknown',
      port: airplay?.port || 7000,
      protocols: protocols as any[],
      model: device.model,
      osVersion: airplay?.txt.osvers,
      manufacturer: 'Apple',
      services: {
        airplay: airplay ? { port: airplay.port } : undefined,
        raop: raop ? { port: raop.port } : undefined,
        companionLink: companion ? { port: companion.port } : undefined,
      },
      records: [], // Not used in new implementation
    }
  }
}
