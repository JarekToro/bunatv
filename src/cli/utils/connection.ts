import { DeviceApi, ProtocolType } from "@/core/DeviceApi.ts";
import { findDevice } from "@/cli/utils/device-lookup.ts";
import type { Storage } from "@/core/storage/types.ts";

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
 * Connect to a device for control operations.
 * Finds the device, validates credentials, connects, and returns a ready DeviceApi.
 */
export async function connectToDevice(
  deviceIdentifier: string,
  storage: Storage,
  options?: ConnectOptions
): Promise<DeviceApi> {
  const device = await findDevice(deviceIdentifier);
  const deviceApi = new DeviceApi(device, storage);

  if (!(await deviceApi.isPaired(ProtocolType.Companion))) {
    throw new NotPairedError(device.identifier);
  }

  await deviceApi.connect({
    companion: {
      transportOptions: {
        timeout: options?.timeout ?? 10000,
        autoReconnect: options?.autoRecover ?? true,
      },
    },
  });

  return deviceApi;
}
