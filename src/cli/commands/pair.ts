/**
 * Pair command - Pair with an Apple TV device
 */

import { Command } from "@cliffy/command";
import { Secret } from "@cliffy/prompt";
import { findDevice } from "@/cli/utils/device-lookup.ts";
import { DeviceApi, ProtocolType } from "@/core/DeviceApi.ts";
import { CredentialManager } from "@/cli/core/credential-manager.ts";
import { JsonStorage } from "@/core/storage/json-storage.ts";
import { createOutput } from "../utils/output";
import { withErrorHandling } from "../utils/errors";
import type { GlobalOptions } from "@/cli/cli.ts";

export const pairCommand = new Command<GlobalOptions>()
  .description("Pair with an Apple TV device")
  .arguments("<device:string>")
  .option(
    "--protocol <type:string>",
    "Protocol to use for pairing (companion)",
    {
      default: "companion",
    }
  )
  .option("--no-save", "Do not save pairing credentials")
  .option("-t, --timeout <seconds:number>", "Pairing timeout in seconds", {
    default: 30,
  })
  .option("--force", "Force re-pairing even if already paired")
  .action(async (options, deviceArg: string) => {
    const { protocol, save, timeout, force } = options;
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      noColor: options.color,
    });

    await withErrorHandling(output, async () => {
      output.status("📱", `Pairing with device: ${deviceArg}`);
      output.info(`   Protocol: ${protocol}`);
      output.debug(`   Timeout: ${timeout} seconds`);
      output.debug(`   Save credentials: ${save ? "Yes" : "No"}`);

      // Validate protocol
      if (protocol !== "companion") {
        output.error(`Invalid protocol: ${protocol}`);
        output.error('Currently only "companion" protocol is supported');
        process.exit(1);
      }

      // Find device
      const device = await findDevice(deviceArg);

      output.info(`   Found: ${device.name} (${device.address})`);

      // Setup DeviceApi
      const storage = new JsonStorage();
      const deviceApi = new DeviceApi(device, storage);

      // Validate protocol support
      if (!deviceApi.hasProtocol(ProtocolType.Companion)) {
        output.error("Device does not support Companion protocol");
        process.exit(1);
      }

      // Check existing pairing
      const credManager = new CredentialManager(storage);
      const alreadyPaired = await deviceApi.isPaired(ProtocolType.Companion);

      if (alreadyPaired && !force) {
        output.warn("Device is already paired");
        output.info("   Use --force to re-pair");
        process.exit(0);
      }

      if (force && alreadyPaired) {
        output.info("Removing existing credentials...");
        await credManager.deleteCredentials(device.identifier);
      }

      // Setup PIN prompt
      const onPinRequired = async (): Promise<string> => {
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

      // Start pairing
      output.info("Initiating pairing...");
      output.info("\n🔢 A 4-digit PIN will appear on your Apple TV screen");

      try {
        await deviceApi.connect({
          companion: {
            authOptions: { onPinRequired },
            transportOptions: {
              timeout: timeout * 1000,
              autoReconnect: false,
            },
          },
        });

        output.info("Pairing successful!");

        // Verify credentials were saved
        const credentialsSaved = await deviceApi.isPaired(
          ProtocolType.Companion
        );

        if (save && credentialsSaved) {
          output.success("✅ Credentials saved for future connections");
        } else if (!save) {
          output.warn("⚠️  Credentials not saved (--no-save flag)");
          await credManager.deleteCredentials(device.identifier);
        }

        // Disconnect
        await deviceApi.disconnect("Pairing complete");

        // Output result
        const result = {
          success: true,
          device: device.name,
          identifier: device.identifier,
          address: device.address,
          protocol: protocol,
          saved: save && credentialsSaved,
          timestamp: new Date().toISOString(),
        };

        if (options.output === "json") {
          output.result(result);
        } else {
          output.result({
            "✅ Status": "Successfully paired",
            Device: device.name,
            Address: `${device.address}:${device.services.companionLink?.port ?? device.services.airPlay?.port ?? 0}`,
            Credentials: save ? "Saved" : "Not saved",
          });
        }
      } catch (error) {
        output.failSpinner("Pairing failed");
        throw error;
      }
    });
  });
