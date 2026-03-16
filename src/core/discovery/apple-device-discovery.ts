import {
  MDNSServiceRegistry,
  type ServiceInstance,
} from "./mdns-service-registry";
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
  type AppleServiceType,
  type AppleServiceTypeMap,
} from "./discovery-types";
import { parseFeatures } from "@/core/utils/airplay-utils.ts";

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
      this.registry.pruneExpired();
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
      this.registry.pruneExpired();
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
      this.registry.pruneExpired();
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
  getServices<T extends AppleServiceType>(type: T): AppleServiceTypeMap[T][] {
    const instances = this.registry.getServiceInstances(type);
    return instances.map((instance) => {
      return this.resolveAppleService(instance, type);
    });
  }

  private resolveAppleService<T extends AppleServiceType>(
    instance: ServiceInstance,
    type: T
  ): AppleServiceTypeMap[typeof type] {
    const validators = {
      [APPLE_SERVICE_TYPES.AIRPLAY]: isAirPlayMetadata,
      [APPLE_SERVICE_TYPES.RAOP]: isRAOPMetadata,
      [APPLE_SERVICE_TYPES.COMPANION_LINK]: isCompanionLinkMetadata,
      [APPLE_SERVICE_TYPES.DEVICE_INFO]: isDeviceInfoMetadata,
      [APPLE_SERVICE_TYPES.HOMEKIT]: () => false,
    };
    const validator = validators[type];

    if (!validator(instance.txt)) {
      console.warn(`Invalid metadata for ${instance.instanceName}`);
    }
    const txt = instance.txt;
    const additionalInfo: Record<string, any> = {};
    if (isAirPlayMetadata(txt)) {
      additionalInfo["features"] = parseFeatures(txt.features);
    } else if (isRAOPMetadata(txt)) {
      additionalInfo["features"] = parseFeatures(txt.ft);
    }
    return {
      ...instance,
      serviceType: APPLE_SERVICE_TYPES.AIRPLAY,
      ...additionalInfo,
      txt,
    } as AppleServiceTypeMap[T];
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
    const airplayServices = this.getServices(APPLE_SERVICE_TYPES.AIRPLAY);

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
      const raop = this._findRelatedService(name, APPLE_SERVICE_TYPES.RAOP);
      const companionLink = this._findRelatedService(
        name,
        APPLE_SERVICE_TYPES.COMPANION_LINK
      );
      const deviceInfo = this._findRelatedService(
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
  // getServices<T extends AppleServiceType>(type: T): AppleServiceTypeMap[T][] {

  private _findRelatedService<T extends AppleServiceType>(
    deviceName: string,
    serviceType: T
  ): AppleServiceTypeMap[T] | undefined {
    const instances = this.registry.getServiceInstances(serviceType);

    for (const instance of instances) {
      // Match by device name in instance name
      // e.g., "Apple TV 4K._raop._tcp.local" contains "Apple TV 4K"
      // or "3E7EE578B0CB@Apple TV 4K._raop._tcp.local" contains "Apple TV 4K"
      if (instance.instanceName.includes(deviceName)) {
        return this.resolveAppleService(instance, serviceType);
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
      await this.discover();
    } finally {
      this.refreshing = false;
    }
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
