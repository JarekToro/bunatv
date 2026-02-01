import type { DiscoveredDevice } from "@/core/discovery/discovery-types.ts";
import type { Storage } from "@/core/storage/types.ts";
import { Secret } from "@cliffy/prompt";
import { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
export interface ConnectionOptions {
  timeout?: number;
  onPinRequired?: () => Promise<string>;
  autoRecover?: boolean;
}

export class ProtocolManager {
  /**
   * Create a Companion Protocol instance
   */
  async createProtocol(
    device: DiscoveredDevice,
    storage: Storage
  ): Promise<CompanionProtocol> {
    try {
      return await CompanionProtocol.create(device, storage);
    } catch (error) {
      throw new Error(`Failed to create protocol: ${(error as Error).message}`);
    }
  }

  /**
   * Connect to device with options
   */
  async connect(
    protocol: CompanionProtocol,
    options?: ConnectionOptions
  ): Promise<void> {
    try {
      await protocol.connect(
        {
          onPinRequired: options?.onPinRequired,
        },
        {
          timeout: options?.timeout,
          autoReconnect: options?.autoRecover,
        }
      );
    } catch (error) {
      throw new Error(`Connection failed: ${(error as Error).message}`);
    }
  }

  /**
   * Disconnect from device
   */
  async disconnect(
    protocol: CompanionProtocol,
    reason: string = "User requested"
  ): Promise<void> {
    try {
      await protocol.disconnect(reason);
    } catch (error) {
      // Log but don't throw - disconnect should be best-effort
      console.error("Disconnect warning:", (error as Error).message);
    }
  }

  /**
   * Setup PIN prompt callback for pairing
   */
  setupPinPrompt(): () => Promise<string> {
    return async (): Promise<string> => {
      return await Secret.prompt({
        message: "Enter 4-digit PIN from Apple TV",
        validate: (value: string) => {
          if (!/^\d{4}$/.test(value)) {
            return "PIN must be exactly 4 digits";
          }
          return true;
        },
      });
    };
  }
}
