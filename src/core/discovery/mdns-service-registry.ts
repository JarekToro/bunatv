import type { Answer, SrvAnswer, TxtAnswer, StringAnswer } from 'dns-packet'
import { join } from 'path'
import { homedir } from 'os'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { MDNSResponse } from '@/core/discovery/mdns-network-discovery.ts'

// ============================================================================
// Types
// ============================================================================

export interface AddressRecord {
  name: string
  type: 'A' | 'AAAA'
  class: string
  ttl: number
  address: string
  expiresAt: number
}

export interface HostAddresses {
  ipv4: AddressRecord[]
  ipv6: AddressRecord[]
}

export interface ServiceInstance {
  instanceName: string // "Apple TV 4K._airplay._tcp.local"
  serviceType: string // "_airplay._tcp.local"
  hostname: string // "Apple-TV-4K.local"
  port: number
  txt: Record<string, string>
  expiresAt: number
}

export interface ResolvedService {
  instance: ServiceInstance
  ipv4: string[]
  ipv6: string[]
}

export interface ConnectionInfo {
  host: string
  port: number
  metadata: Record<string, string>
}



// ============================================================================
// Base mDNS Discovery Service
// ============================================================================

/**
 * Base mDNS service registry for caching and querying mDNS records
 * This is a passive cache - it doesn't perform network discovery itself
 */
export class MDNSServiceRegistry {
  private hosts = new Map<string, HostAddresses>()
  private services = new Map<string, ServiceInstance[]>() // serviceType → instances
  private cachePath: string
  private saveTimeout: Timer | null = null
  private loadPromise: Promise<void>

  constructor(cachePath?: string) {
    this.cachePath = cachePath || join(homedir(), '.cache', 'bunatv-mdns', 'registry.json')
    // Auto-load cache on construction (async, non-blocking)
    this.loadPromise = this._loadFromDisk().catch(() => {
      // Ignore errors on first load (cache might not exist yet)
    })
  }

  /**
   * Ensure the cache has finished loading from disk
   */
  async ensureLoaded(): Promise<void> {
    await this.loadPromise
  }

  // ========================================================================
  // Address Resolution Methods
  // ========================================================================

  /**
   * Get all IP addresses for a hostname
   */
  getAddresses(hostname: string, type: 'A' | 'AAAA' = 'A'): string[] {
    const host = this.hosts.get(hostname)
    if (!host) return []

    const now = Date.now()
    const records = type === 'A' ? host.ipv4 : host.ipv6

    return records.filter(record => record.expiresAt > now).map(record => record.address)
  }

  /**
   * Get the first valid IP address
   */
  getFirstAddress(hostname: string, type: 'A' | 'AAAA' = 'A'): string | null {
    const addresses = this.getAddresses(hostname, type)
    return addresses[0] || null
  }

  /**
   * Get all addresses (both IPv4 and IPv6)
   */
  getAllAddresses(hostname: string): { ipv4: string[]; ipv6: string[] } {
    return {
      ipv4: this.getAddresses(hostname, 'A'),
      ipv6: this.getAddresses(hostname, 'AAAA'),
    }
  }

  /**
   * Check if hostname has valid cached addresses
   */
  hasAddress(hostname: string): boolean {
    const addresses = this.getAllAddresses(hostname)
    return addresses.ipv4.length > 0 || addresses.ipv6.length > 0
  }

  // ========================================================================
  // Service Discovery Methods
  // ========================================================================

  /**
   * Get all instances of a service type
   */
  getServiceInstances(serviceType: string): ServiceInstance[] {
    const instances = this.services.get(serviceType) || []
    const now = Date.now()

    return instances.filter(instance => instance.expiresAt > now)
  }

  /**
   * Get all service types currently cached
   */
  getServiceTypes(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * Get all service instances across all types
   */
  getAllServiceInstances(): ServiceInstance[] {
    const now = Date.now()
    const allInstances: ServiceInstance[] = []

    for (const instances of this.services.values()) {
      allInstances.push(...instances.filter(i => i.expiresAt > now))
    }

    return allInstances
  }

  /**
   * Resolve a service instance to full connection info (with IPs)
   */
  resolveService(instanceName: string): ResolvedService | null {
    // Find the instance across all service types
    for (const instances of this.services.values()) {
      const instance = instances.find(i => i.instanceName === instanceName)
      if (instance && instance.expiresAt > Date.now()) {
        return {
          instance,
          ipv4: this.getAddresses(instance.hostname, 'A'),
          ipv6: this.getAddresses(instance.hostname, 'AAAA'),
        }
      }
    }
    return null
  }

  /**
   * Get first available IP for connecting to a service
   */
  getServiceConnection(instanceName: string): ConnectionInfo | null {
    const resolved = this.resolveService(instanceName)
    if (!resolved) return null

    const ip = resolved.ipv4[0] || resolved.ipv6[0]
    if (!ip) return null

    return {
      host: ip,
      port: resolved.instance.port,
      metadata: resolved.instance.txt,
    }
  }

  /**
   * Check if a service instance exists
   */
  hasService(instanceName: string): boolean {
    return this.resolveService(instanceName) !== null
  }

  // ========================================================================
  // Update Methods
  // ========================================================================

  /**
   * Process mDNS response - updates both addresses and services
   * This is the main entry point for updating from multicast-dns responses
   */
  updateFromResponse(response: MDNSResponse): void {
    this._updateAddresses(response.additionals)
    this._updateServices(response)
    // Auto-save to disk after update (debounced)
    this._debouncedSave()
  }

  /**
   * Update only address records (A/AAAA)
   */
  private _updateAddresses(records: Answer[]): void {
    // Group records by hostname and type for atomic cache-flush handling
    const grouped = new Map<string, Answer[]>()

    for (const record of records) {
      if (record.type !== 'A' && record.type !== 'AAAA') continue

      const key = `${record.name}:${record.type}`
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(record)
    }

    // Process each group atomically
    for (const [key, groupRecords] of grouped) {
      const [hostname, type] = key.split(':')
      const hasFlush = groupRecords.some(r => (r as any).flush === true)

      if (!hostname) continue
      let host = this.hosts.get(hostname)
      if (!host) {
        host = { ipv4: [], ipv6: [] }
        this.hosts.set(hostname, host)
      }

      const recordList = type === 'A' ? 'ipv4' : 'ipv6'

      // Cache-flush: replace all existing records of this type
      if (hasFlush) {
        host[recordList] = []
      }

      // Add new records
      const now = Date.now()
      for (const record of groupRecords) {
        const stringRecord = record as StringAnswer

        const addressRecord: AddressRecord = {
          name: stringRecord.name,
          type: stringRecord.type as 'A' | 'AAAA',
          class: stringRecord.class || 'IN',
          ttl: stringRecord.ttl || 0,
          address: stringRecord.data,
          expiresAt: now + (stringRecord.ttl || 0) * 1000,
        }

        const existing = host[recordList].find(r => r.address === stringRecord.data)

        if (existing) {
          // Refresh TTL
          existing.ttl = addressRecord.ttl
          existing.expiresAt = addressRecord.expiresAt
        } else {
          host[recordList].push(addressRecord)
        }
      }
    }
  }

  /**
   * Update service records (PTR → SRV → TXT chain)
   */
  private _updateServices(response: MDNSResponse): void {
    const now = Date.now()

    // Step 1: Extract PTR records (service instances)
    const ptrRecords = response.answers.filter((r): r is StringAnswer => r.type === 'PTR')

    for (const ptr of ptrRecords) {
      const serviceType = ptr.name
      const instanceName = ptr.data

      // Step 2: Find SRV record for this instance (in additionals)
      const srv = response.additionals.find(
        (r): r is SrvAnswer => r.name === instanceName && r.type === 'SRV'
      ) as SrvAnswer | undefined

      if (!srv) continue // Incomplete data, skip

      // Step 3: Find TXT record (optional metadata)
      const txt = response.additionals.find(
        (r): r is TxtAnswer => r.name === instanceName && r.type === 'TXT'
      ) as TxtAnswer | undefined

      // Parse TXT data
      const txtRecord = this._parseTxtRecord(txt)

      // Create service instance
      const instance: ServiceInstance = {
        instanceName,
        serviceType,
        hostname: srv.data.target,
        port: srv.data.port,
        txt: txtRecord,
        expiresAt: now + (ptr.ttl || 0) * 1000,
      }

      // Store in cache
      if (!this.services.has(serviceType)) {
        this.services.set(serviceType, [])
      }

      const instances = this.services.get(serviceType)!
      const existingIndex = instances.findIndex(i => i.instanceName === instanceName)

      if (existingIndex >= 0) {
        // Update existing
        instances[existingIndex] = instance
      } else {
        // Add new
        instances.push(instance)
      }
    }
  }

  /**
   * Parse TXT record data into key-value pairs
   */
  private _parseTxtRecord(txt: TxtAnswer | undefined): Record<string, string> {
    const result: Record<string, string> = {}

    if (!txt?.data) return result

    const entries = Array.isArray(txt.data) ? txt.data : [txt.data]

    for (const entry of entries) {
      const str = Buffer.isBuffer(entry) ? entry.toString() : entry
      const [key, ...valueParts] = str.split('=')
      if (key) {
        result[key] = valueParts.join('=')
      }
    }

    return result
  }

  // ========================================================================
  // Maintenance Methods
  // ========================================================================

  /**
   * Remove expired records (both addresses and services)
   */
  pruneExpired(): { addresses: number; services: number } {
    const result = {
      addresses: this._pruneExpiredAddresses(),
      services: this._pruneExpiredServices(),
    }
    // Auto-save after pruning
    this._debouncedSave()
    return result
  }

  private _pruneExpiredAddresses(): number {
    const now = Date.now()
    let pruned = 0

    for (const [hostname, host] of this.hosts.entries()) {
      const beforeIpv4 = host.ipv4.length
      const beforeIpv6 = host.ipv6.length

      host.ipv4 = host.ipv4.filter(r => r.expiresAt > now)
      host.ipv6 = host.ipv6.filter(r => r.expiresAt > now)

      pruned += beforeIpv4 - host.ipv4.length + (beforeIpv6 - host.ipv6.length)

      // Remove host if no records remain
      if (host.ipv4.length === 0 && host.ipv6.length === 0) {
        this.hosts.delete(hostname)
      }
    }

    return pruned
  }

  private _pruneExpiredServices(): number {
    const now = Date.now()
    let pruned = 0

    for (const [serviceType, instances] of this.services.entries()) {
      const before = instances.length
      const filtered = instances.filter(i => i.expiresAt > now)
      this.services.set(serviceType, filtered)
      pruned += before - filtered.length

      // Remove service type if no instances remain
      if (filtered.length === 0) {
        this.services.delete(serviceType)
      }
    }

    return pruned
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.hosts.clear()
    this.services.clear()
  }

  /**
   * Clear only address cache
   */
  clearAddresses(): void {
    this.hosts.clear()
  }

  /**
   * Clear only service cache
   */
  clearServices(): void {
    this.services.clear()
  }

  // ========================================================================
  // Statistics & Debugging
  // ========================================================================

  /**
   * Get comprehensive statistics
   */
  getStats() {
    const now = Date.now()

    // Address stats
    let totalAddresses = 0
    let expiredAddresses = 0
    for (const host of this.hosts.values()) {
      for (const record of [...host.ipv4, ...host.ipv6]) {
        totalAddresses++
        if (record.expiresAt <= now) {
          expiredAddresses++
        }
      }
    }

    // Service stats
    let totalServices = 0
    let expiredServices = 0
    for (const instances of this.services.values()) {
      for (const instance of instances) {
        totalServices++
        if (instance.expiresAt <= now) {
          expiredServices++
        }
      }
    }

    return {
      hosts: {
        total: this.hosts.size,
        records: totalAddresses,
        active: totalAddresses - expiredAddresses,
        expired: expiredAddresses,
      },
      services: {
        types: this.services.size,
        instances: totalServices,
        active: totalServices - expiredServices,
        expired: expiredServices,
      },
    }
  }

  /**
   * Get all cached hostnames
   */
  getHostnames(): string[] {
    return Array.from(this.hosts.keys())
  }

  /**
   * Export current state (for debugging/persistence)
   */
  exportState() {
    return {
      hosts: Array.from(this.hosts.entries()),
      services: Array.from(this.services.entries()),
      timestamp: Date.now(),
    }
  }

  /**
   * Get cache staleness information
   */
  getCacheStaleness(): { total: number; expired: number; percentage: number } {
    const now = Date.now()
    let total = 0
    let expired = 0

    // Count address records
    for (const host of this.hosts.values()) {
      for (const record of [...host.ipv4, ...host.ipv6]) {
        total++
        if (record.expiresAt <= now) {
          expired++
        }
      }
    }

    // Count service instances
    for (const instances of this.services.values()) {
      for (const instance of instances) {
        total++
        if (instance.expiresAt <= now) {
          expired++
        }
      }
    }

    return {
      total,
      expired,
      percentage: total > 0 ? expired / total : 0,
    }
  }

  /**
   * Check if cache is stale based on expiration threshold
   */
  isStale(threshold: number = 0.5): boolean {
    const staleness = this.getCacheStaleness()
    return staleness.percentage >= threshold
  }

  // ========================================================================
  // Private Persistence Methods
  // ========================================================================

  /**
   * Debounced save - prevents excessive disk writes
   */
  private _debouncedSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }
    this.saveTimeout = setTimeout(() => {
      this._saveToDisk().catch(err => {
        console.error('Failed to save mDNS cache:', err)
      })
    }, 1000) // 1 second debounce
  }

  /**
   * Load cache from disk
   */
  private async _loadFromDisk(): Promise<void> {
    try {
      if (!existsSync(this.cachePath)) {
        return // Cache doesn't exist yet
      }

      const data = await readFile(this.cachePath, 'utf-8')
      const parsed = JSON.parse(data)

      // Restore hosts
      if (parsed.hosts) {
        this.hosts = new Map(parsed.hosts)
      }

      // Restore services
      if (parsed.services) {
        this.services = new Map(parsed.services)
      }
    } catch (error) {
      // Ignore load errors - cache will be rebuilt
      console.error('Failed to load mDNS cache:', error)
    }
  }

  /**
   * Save cache to disk
   */
  private async _saveToDisk(): Promise<void> {
    try {
      // Ensure cache directory exists
      const cacheDir = join(this.cachePath, '..')
      if (!existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true })
      }

      const state = this.exportState()
      await writeFile(this.cachePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save mDNS cache:', error)
      throw error
    }
  }
}
