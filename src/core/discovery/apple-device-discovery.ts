import { MDNSServiceRegistry } from "./mdns-service-registry";
import { MDNSNetworkDiscovery } from "./mdns-network-discovery";
import { isIP } from "net";
import {
  APPLE_SERVICE_TYPES,
  type AppleTVDevice,
  type HomePodDevice,
  type MacDevice,
  type AppleDevice,
  type AirPlayService,
  type RAOPService,
  type CompanionLinkService,
  type DeviceInfoService,
  type AirPlayMetadata,
  type RAOPMetadata,
  type CompanionLinkMetadata,
  type DeviceInfoMetadata,
  isAppleTVModel,
  isHomePodModel,
  getFriendlyDeviceName,
  isRAOPMetadata,
  isCompanionLinkMetadata,
  isDeviceInfoMetadata,
  isAirPlayMetadata,
} from "./discovery-types";

// ============================================================================
// Apple TV Discovery Service
// ============================================================================

/**
 * Orchestrator for discovering Apple devices (Apple TV, HomePod, Mac)
 * Owns and coordinates the registry (cache) and network discovery
 */
export class AppleTVDiscoveryService {
  private registry: MDNSServiceRegistry;
  private network: MDNSNetworkDiscovery;
  private refreshing = false;

  constructor() {
    this.registry = new MDNSServiceRegistry();
    this.network = new MDNSNetworkDiscovery((response) =>
      this.registry.updateFromResponse(response)
    );
  }

  // ========================================================================
  // High-Level Discovery API
  // ========================================================================

  /**
   * Discover Apple devices on the network
   * @param timeoutMs How long to listen for responses (default: 5000ms)
   */
  async discover(timeoutMs: number = 5000): Promise<AppleDevice[]> {
    this.network.start();

    // Query for all Apple service types
    this.network.query([
      APPLE_SERVICE_TYPES.AIRPLAY,
      APPLE_SERVICE_TYPES.RAOP,
      APPLE_SERVICE_TYPES.COMPANION_LINK,
      APPLE_SERVICE_TYPES.DEVICE_INFO,
    ]);

    // Wait for responses
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));

    this.network.stop();

    return this.getAllAppleDevices();
  }

  /**
   * Stop discovery and cleanup
   */
  stop(): void {
    this.network.stop();
  }

  /**
   * Clear all cached discovery data
   */
  clear(): void {
    this.registry.clear();
  }

  /**
   * Get discovery statistics
   */
  getStats() {
    return this.registry.getStats();
  }

  // ========================================================================
  // Apple-Specific Query Methods
  // ========================================================================

  /**
   * Get all discovered Apple TV devices
   */
  async getAppleTVs(): Promise<AppleTVDevice[]> {
    await this._ensureFreshCache();
    return this._getAppleDevices("appletv");
  }

  /**
   * Get all discovered HomePod devices
   */
  async getHomePods(): Promise<HomePodDevice[]> {
    await this._ensureFreshCache();
    return this._getAppleDevices("homepod");
  }

  /**
   * Get all discovered Mac devices
   */
  async getMacs(): Promise<MacDevice[]> {
    await this._ensureFreshCache();
    return this._getAppleDevices("mac");
  }

  /**
   * Get all Apple devices (Apple TV, HomePod, Mac)
   */
  async getAllAppleDevices(): Promise<AppleDevice[]> {
    await this._ensureFreshCache();
    return [
      ...this._getAppleDevices("appletv"),
      ...this._getAppleDevices("homepod"),
      ...this._getAppleDevices("mac"),
    ];
  }

  /**
   * Get a specific Apple device by name
   */
  async getAppleDevice(name: string): Promise<AppleDevice | null> {
    await this.registry.ensureLoaded();
    // Check if device exists and is not expired
    let device = this._findDevice(name);
    if (!device || this._isDeviceExpired(device)) {
      // If we have a stale device with an IP, use it for unicast refresh
      const refreshTarget = device?.ipv4?.[0] || name;
      await this._refreshDevice(refreshTarget);
      device = this._findDevice(name);
    }
    return device;
  }

  /**
   * Get a specific Apple device by hostname
   */
  async getAppleDeviceByHostname(
    hostname: string
  ): Promise<AppleDevice | null> {
    await this.registry.ensureLoaded();
    // Check if device exists and is not expired
    let device = this._findDeviceByHostname(hostname);
    if (!device || this._isDeviceExpired(device)) {
      // If we have a stale device with an IP, use it for unicast refresh
      const refreshTarget = device?.ipv4?.[0] || hostname;
      await this._refreshDevice(refreshTarget);
      device = this._findDeviceByHostname(hostname);
    }
    return device;
  }

  /**
   * Get a specific Apple device by IP address
   */
  async getAppleDeviceByIPAddress(
    ipAddress: string
  ): Promise<AppleDevice | null> {
    await this.registry.ensureLoaded();
    // Check if device exists and is not expired
    let device = this._getDeviceByIPAddress(ipAddress);
    if (!device || this._isDeviceExpired(device)) {
      // If we have a stale device with an IP, use it for unicast refresh
      await this._refreshDevice(ipAddress);
      device = this._getDeviceByIPAddress(ipAddress);
    }
    return device;
  }

  // ========================================================================
  // Typed Service Access
  // ========================================================================

  /**
   * Get all AirPlay services with typed metadata
   */
  getAirPlayServices(): AirPlayService[] {
    const instances = this.registry.getServiceInstances(
      APPLE_SERVICE_TYPES.AIRPLAY
    );
    return instances.map((instance) => {
      if (!isAirPlayMetadata(instance.txt)) {
        console.warn(`Invalid AirPlay metadata for ${instance.instanceName}`);
      }
      const txt = instance.txt as unknown as AirPlayMetadata;
      return {
        ...instance,
        serviceType: APPLE_SERVICE_TYPES.AIRPLAY,
        txt,
      };
    }) as AirPlayService[];
  }

  /**
   * Get all RAOP services with typed metadata
   */
  getRAOPServices(): RAOPService[] {
    const instances = this.registry.getServiceInstances(
      APPLE_SERVICE_TYPES.RAOP
    );
    return instances.map((instance) => {
      if (!isRAOPMetadata(instance.txt)) {
        console.warn(`Invalid RAOP metadata for ${instance.instanceName}`);
      }
      const txt = instance.txt as unknown as RAOPMetadata;
      return {
        ...instance,
        serviceType: APPLE_SERVICE_TYPES.RAOP,
        txt,
      };
    });
  }

  /**
   * Get all Companion Link services with typed metadata
   */
  getCompanionLinkServices(): CompanionLinkService[] {
    const instances = this.registry.getServiceInstances(
      APPLE_SERVICE_TYPES.COMPANION_LINK
    );
    return instances.map((instance) => {
      if (!isCompanionLinkMetadata(instance.txt)) {
        console.warn(
          `Invalid Companion Link metadata for ${instance.instanceName}`
        );
      }
      const txt = instance.txt as unknown as CompanionLinkMetadata;
      return {
        ...instance,
        serviceType: APPLE_SERVICE_TYPES.COMPANION_LINK,
        txt,
      };
    });
  }

  /**
   * Get all Device Info services with typed metadata
   */
  getDeviceInfoServices(): DeviceInfoService[] {
    const instances = this.registry.getServiceInstances(
      APPLE_SERVICE_TYPES.DEVICE_INFO
    );
    return instances.map((instance) => {
      if (!isDeviceInfoMetadata(instance.txt)) {
        console.warn(
          `Invalid Device Info metadata for ${instance.instanceName}`
        );
      }
      const txt = instance.txt as unknown as DeviceInfoMetadata;
      return {
        ...instance,
        serviceType: APPLE_SERVICE_TYPES.DEVICE_INFO,
        txt,
      };
    }) as DeviceInfoService[];
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  /**
   * Internal method to build Apple device objects from discovered services
   */
  private _getAppleDevices(
    deviceType: "appletv" | "homepod" | "mac"
  ): AppleDevice[] {
    const devices = new Map<string, AppleDevice>();
    const now = Date.now();

    // Get all AirPlay services as they're the primary indicator of Apple devices
    const airplayServices = this.getAirPlayServices();

    for (const airplay of airplayServices) {
      const model = airplay.txt.model;

      // Filter by device type
      let isMatch = false;
      if (deviceType === "appletv") {
        isMatch = isAppleTVModel(model);
      } else if (deviceType === "homepod") {
        isMatch = isHomePodModel(model);
      } else if (deviceType === "mac") {
        // Macs typically have model like "Mac14,9"
        isMatch = model.startsWith("Mac") && model.includes(",");
      }

      if (!isMatch) continue;

      // Extract device name from instance name (e.g., "Apple TV 4K._airplay._tcp.local" -> "Apple TV 4K")
      const name = airplay.instanceName.replace(/\._airplay\._tcp\.local$/, "");
      const hostname = airplay.hostname;

      // Get IP addresses
      const addresses = this.registry.getAllAddresses(hostname);

      // Find related services for this device
      const raop = this._findRelatedService<RAOPService>(
        name,
        APPLE_SERVICE_TYPES.RAOP
      );
      const companionLink = this._findRelatedService<CompanionLinkService>(
        name,
        APPLE_SERVICE_TYPES.COMPANION_LINK
      );
      const deviceInfo = this._findRelatedService<DeviceInfoService>(
        name,
        APPLE_SERVICE_TYPES.DEVICE_INFO
      );

      // Build device object based on type
      if (deviceType === "appletv") {
        const device: AppleTVDevice = {
          name,
          identifier: airplay.txt.deviceid,
          address: (addresses.ipv4[0] || addresses.ipv6[0])!,
          hostname,
          ipv4: addresses.ipv4,
          ipv6: addresses.ipv6,
          model: getFriendlyDeviceName(model),
          services: {
            airPlay: airplay,
            raop,
            companionLink,
            deviceInfo,
          },
          lastSeen: now,
        };
        devices.set(name, device);
      } else if (deviceType === "homepod") {
        const device: HomePodDevice = {
          name,
          identifier: airplay.txt.deviceid,
          address: (addresses.ipv4[0] || addresses.ipv6[0])!,
          hostname,
          ipv4: addresses.ipv4,
          ipv6: addresses.ipv6,
          model: getFriendlyDeviceName(model),
          services: {
            airPlay: airplay,
            raop,
            companionLink,
          },
          lastSeen: now,
        };
        devices.set(name, device);
      } else if (deviceType === "mac") {
        const device: MacDevice = {
          name,
          identifier: airplay.txt.deviceid,
          address: (addresses.ipv4[0] || addresses.ipv6[0])!,
          hostname,
          ipv4: addresses.ipv4,
          ipv6: addresses.ipv6,
          model,
          osxVersion: deviceInfo?.txt.osxvers,
          services: {
            airPlay: airplay,
            raop,
            companionLink,
            deviceInfo,
          },
          lastSeen: now,
        };
        devices.set(name, device);
      }
    }

    return Array.from(devices.values());
  }

  /**
   * Find a related service for a device by matching the device name
   */
  private _findRelatedService<
    T extends { instanceName: string; serviceType: string },
  >(deviceName: string, serviceType: string): T | undefined {
    const instances = this.registry.getServiceInstances(serviceType);

    for (const instance of instances) {
      // Match by device name in instance name
      // e.g., "Apple TV 4K._raop._tcp.local" contains "Apple TV 4K"
      // or "3E7EE578B0CB@Apple TV 4K._raop._tcp.local" contains "Apple TV 4K"
      if (instance.instanceName.includes(deviceName)) {
        return instance as unknown as T;
      }
    }

    return undefined;
  }
  // ========================================================================
  // Private Helper Methods (Refresh & Caching)
  // ========================================================================

  private async _ensureFreshCache(): Promise<void> {
    if (this.refreshing) return;

    await this.registry.ensureLoaded();

    const stats = this.registry.getStats();
    const isEmpty = stats.services.instances === 0;
    const isStale = this.registry.isStale(0.5);

    if (isEmpty || isStale) {
      await this._refresh();
    }
  }

  private async _refresh(timeoutMs: number = 3000): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.network.start();

      // Query for all Apple service types
      const types = [
        APPLE_SERVICE_TYPES.AIRPLAY,
        APPLE_SERVICE_TYPES.RAOP,
        APPLE_SERVICE_TYPES.COMPANION_LINK,
        APPLE_SERVICE_TYPES.DEVICE_INFO,
      ];

      this.network.query(types);
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      this.network.stop();
    } finally {
      this.refreshing = false;
    }
  }

  private _findDevice(name: string): AppleDevice | null {
    // We can't use getAllAppleDevices() here because it calls _ensureFreshCache which might recurse
    // Instead we use the internal _getAppleDevices which is synchronous/direct
    const all = [
      ...this._getAppleDevices("appletv"),
      ...this._getAppleDevices("homepod"),
      ...this._getAppleDevices("mac"),
    ];
    return all.find((device) => device.name === name) || null;
  }

  private _findDeviceByHostname(hostname: string): AppleDevice | null {
    const all = [
      ...this._getAppleDevices("appletv"),
      ...this._getAppleDevices("homepod"),
      ...this._getAppleDevices("mac"),
    ];
    return all.find((device) => device.hostname === hostname) || null;
  }

  private _getDeviceByIPAddress(ipAddress: string): AppleDevice | null {
    const all = [
      ...this._getAppleDevices("appletv"),
      ...this._getAppleDevices("homepod"),
      ...this._getAppleDevices("mac"),
    ];
    console.log("Looking for device with IP:", ipAddress);
    all.forEach((device) => {
      console.log(
        `Checking device ${device.name} with IPs: ${device.ipv4.join(", ")} / ${device.ipv6.join(", ")}`
      );
    });
    return (
      all.find(
        (device) =>
          device.ipv4.includes(ipAddress) || device.ipv6.includes(ipAddress)
      ) || null
    );
  }

  private _isDeviceExpired(device: AppleDevice): boolean {
    // Check if primary service (AirPlay) is expired
    if (device.services.airPlay) {
      return device.services.airPlay.expiresAt <= Date.now();
    }
    return true;
  }

  private async _refreshDevice(identifier: string): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      this.network.start();

      const types = [
        APPLE_SERVICE_TYPES.AIRPLAY,
        APPLE_SERVICE_TYPES.RAOP,
        APPLE_SERVICE_TYPES.COMPANION_LINK,
        APPLE_SERVICE_TYPES.DEVICE_INFO,
      ];

      // Check if identifier looks like an IP
      if (isIP(identifier)) {
        // Unicast query to specific IP
        this.network.query(types, 5353, identifier);
      } else {
        // Fallback to global multicast refresh
        this.network.query(types);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.network.stop();
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Get AirPlay connection info for a device
   */
  async getAirPlayConnection(deviceName: string): Promise<{
    host: string;
    port: number;
    deviceId: string;
    model: string;
    features: string;
  } | null> {
    const device = await this.getAppleDevice(deviceName);
    if (!device?.services.airPlay) return null;

    const ip = device.ipv4[0] || device.ipv6[0];
    if (!ip) return null;

    const airplay = device.services.airPlay;
    return {
      host: ip,
      port: airplay.port,
      deviceId: airplay.txt.deviceid,
      model: airplay.txt.model,
      features: airplay.txt.features,
    };
  }

  /**
   * Check if a device supports specific AirPlay features
   */
  async supportsAirPlayFeatures(
    deviceName: string,
    features: string[]
  ): Promise<boolean> {
    const device = await this.getAppleDevice(deviceName);
    if (!device?.services.airPlay) return false;

    const deviceFeatures = device.services.airPlay.txt.features;
    // Note: This is a simplified check. Real feature checking would parse the hex flags
    return features.every((feature) => deviceFeatures.includes(feature));
  }

  /**
   * Get device model and OS version info
   */
  async getDeviceInfo(deviceName: string): Promise<{
    model: string;
    friendlyModel: string;
    osVersion?: string;
    firmwareVersion?: string;
  } | null> {
    const device = await this.getAppleDevice(deviceName);
    if (!device) return null;

    const airplay = device.services.airPlay;
    if (!("deviceInfo" in device.services)) {
      return null;
    }
    const deviceInfo = device.services.deviceInfo;

    return {
      model: airplay?.txt.model || deviceInfo?.txt.model || "Unknown",
      friendlyModel: device.model,
      osVersion: airplay?.txt.osvers,
      firmwareVersion: airplay?.txt.srcvers,
    };
  }

  /**
   * Export Apple devices summary
   */
  async exportAppleDevicesSummary() {
    const appleTVs = await this.getAppleTVs();
    const homePods = await this.getHomePods();
    const macs = await this.getMacs();

    return {
      appleTVs: appleTVs.map((tv) => ({
        name: tv.name,
        model: tv.model,
        ip: tv.ipv4[0] || tv.ipv6[0],
        services: Object.keys(tv.services).filter(
          (key) => tv.services[key as keyof typeof tv.services]
        ),
      })),
      homePods: homePods.map((pod) => ({
        name: pod.name,
        model: pod.model,
        ip: pod.ipv4[0] || pod.ipv6[0],
        services: Object.keys(pod.services).filter(
          (key) => pod.services[key as keyof typeof pod.services]
        ),
      })),
      macs: macs.map((mac) => ({
        name: mac.name,
        model: mac.model,
        osxVersion: mac.osxVersion,
        ip: mac.ipv4[0] || mac.ipv6[0],
        services: Object.keys(mac.services).filter(
          (key) => mac.services[key as keyof typeof mac.services]
        ),
      })),
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create queries for all Apple services
 */
export function createAppleServiceQueries() {
  return [
    { name: APPLE_SERVICE_TYPES.AIRPLAY, type: "PTR" as const },
    { name: APPLE_SERVICE_TYPES.RAOP, type: "PTR" as const },
    { name: APPLE_SERVICE_TYPES.COMPANION_LINK, type: "PTR" as const },
    { name: APPLE_SERVICE_TYPES.DEVICE_INFO, type: "PTR" as const },
  ];
}

/**
 * Parse AirPlay features flags
 * Features are in hex format like "0x4A7FDFD5,0x3C175FDE"
 */
export function parseAirPlayFeatures(featuresHex: string): {
  supportsVideo: boolean;
  supportsAudio: boolean;
  supportsScreen: boolean;
  supportsPhoto: boolean;
  requiresPassword: boolean;
} {
  // This is a simplified parser - real implementation would need
  // to parse the hex values and check specific bit flags
  const features = featuresHex.toLowerCase();

  return {
    supportsVideo: true, // Most devices support video
    supportsAudio: true, // Most devices support audio
    supportsScreen: features.includes("0x4a7"), // Screen mirroring
    supportsPhoto: true, // Most devices support photos
    requiresPassword: features.includes("password"), // Simplified check
  };
}

/**
 * Extract device name from service instance name
 * e.g., "Apple TV 4K._airplay._tcp.local" -> "Apple TV 4K"
 * e.g., "3E7EE578B0CB@Apple TV 4K._raop._tcp.local" -> "Apple TV 4K"
 */
export function extractDeviceName(instanceName: string): string {
  // Remove service suffix
  let name = instanceName
    .replace(/\._airplay\._tcp\.local$/, "")
    .replace(/\._raop\._tcp\.local$/, "")
    .replace(/\._companion-link\._tcp\.local$/, "")
    .replace(/\._device-info\._tcp\.local$/, "");

  // Remove RAOP prefix (MAC@Name format)
  const atIndex = name.indexOf("@");
  if (atIndex !== -1) {
    name = name.substring(atIndex + 1);
  }

  return name;
}
