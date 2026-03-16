import { AppleTVDiscoveryService } from "@/core/discovery/apple-device-discovery.ts";
import type { AppleDevice } from "@/core/discovery/discovery-types.ts";

export class DeviceNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Device not found: ${identifier}`);
    this.name = "DeviceNotFoundError";
  }
}

export class NoDevicesFoundError extends Error {
  constructor() {
    super("No Apple TV devices found on the network");
    this.name = "NoDevicesFoundError";
  }
}

/**
 * Find a device by name, hostname, IP, or device ID
 */
export async function findDevice(identifier: string): Promise<AppleDevice> {
  const discovery = new AppleTVDiscoveryService();

  // Try by name first
  let device = await discovery.getAppleDevice(identifier);

  // Try by hostname
  if (!device) {
    device = await discovery.getAppleDeviceByHostname(identifier);
  }

  // Search all devices for matching IP or device ID
  if (!device) {
    const allDevices = await discovery.getAllAppleDevices();
    device =
      allDevices.find((d) => {
        const ipMatch =
          d.ipv4.includes(identifier) || d.ipv6.includes(identifier);
        const idMatch = d.services.airPlay?.txt.deviceid === identifier;
        return ipMatch || idMatch;
      }) ?? null;
  }

  if (!device) {
    throw new DeviceNotFoundError(identifier);
  }

  return device;
}

/**
 * Discover all Apple TV devices on the network
 */
export async function discoverDevices(
  timeoutSeconds: number = 5
): Promise<AppleDevice[]> {
  const discovery = new AppleTVDiscoveryService();
  return discovery.discover(timeoutSeconds * 1000);
}
