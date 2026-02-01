import type { Storage } from "@/core/storage/types.ts";
import { DeviceManager } from "@/cli/core/device-manager.ts";
import { ProtocolManager } from "@/cli/core/protocol-manager.ts";
import { CredentialManager } from "@/cli/core/credential-manager.ts";
import { CompanionApi } from "@/protocols/companion/CompanionApi.ts";

export class NotPairedError extends Error {
  constructor(deviceId: string) {
    super(`Device not paired: ${deviceId}. Run: bunatv pair ${deviceId}`);
    this.name = "NotPairedError";
  }
}

export interface ConnectOptions {
  timeout?: number;
  autoRecover?: boolean;
}

/**
 * Connect to a device for control operations
 * This is a high-level helper that handles all the setup
 */
export async function connectToDevice(
  deviceIdentifier: string,
  storage: Storage,
  options?: ConnectOptions
): Promise<CompanionApi> {
  // 1. Find device
  const deviceManager = new DeviceManager();
  const device = await deviceManager.findDevice(deviceIdentifier);

  // 2. Validate Companion support
  if (!deviceManager.supportsProtocol(device, "companion")) {
    throw new Error("Device does not support Companion protocol");
  }

  // 3. Check credentials
  const credManager = new CredentialManager(storage);
  const hasCredentials = await credManager.hasCredentials(device.identifier);

  if (!hasCredentials) {
    throw new NotPairedError(device.identifier);
  }

  // 4. Create protocol
  const protocolManager = new ProtocolManager();
  const protocol = await protocolManager.createProtocol(device, storage);

  // 5. Connect
  await protocolManager.connect(protocol, {
    timeout: options?.timeout ?? 10000,
    autoRecover: options?.autoRecover ?? true,
  });

  const deviceInfo = await storage.getClientDeviceInfo();

  return new CompanionApi(protocol, { ...deviceInfo });
}
