/**
 * Pair command - Pair with an Apple TV device
 */

import { Command } from "@cliffy/command";
import { DeviceManager } from "@/cli/core/device-manager.ts";
import { ProtocolManager } from "@/cli/core/protocol-manager.ts";
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
      const deviceManager = new DeviceManager();
      const device = await deviceManager.findDevice(deviceArg);

      output.info(`   Found: ${device.name} (${device.address})`);

      // Validate protocol support
      if (!deviceManager.supportsProtocol(device, "companion")) {
        output.error("Device does not support Companion protocol");
        process.exit(1);
      }

      // Check existing pairing
      const storage = new JsonStorage();
      const credManager = new CredentialManager(storage);
      const alreadyPaired = await credManager.hasCredentials(device.identifier);

      if (alreadyPaired && !force) {
        output.warn("Device is already paired");
        output.info("   Use --force to re-pair");
        process.exit(0);
      }

      if (force && alreadyPaired) {
        output.info("Removing existing credentials...");
        await credManager.deleteCredentials(device.identifier);
      }

      // Create protocol
      const protocolManager = new ProtocolManager();
      const companionProtocol = await protocolManager.createProtocol(
        device,
        storage
      );

      // Setup PIN prompt
      const onPinRequired = protocolManager.setupPinPrompt();

      // Start pairing
      output.info("Initiating pairing...");
      output.info("\n🔢 A 4-digit PIN will appear on your Apple TV screen");

      try {
        await protocolManager.connect(companionProtocol, {
          onPinRequired,
          timeout: timeout * 1000,
          autoRecover: false,
        });

        output.info("Pairing successful!");

        // Verify credentials were saved
        const credentialsSaved = await credManager.hasCredentials(
          device.identifier
        );

        if (save && credentialsSaved) {
          output.success("✅ Credentials saved for future connections");
        } else if (!save) {
          output.warn("⚠️  Credentials not saved (--no-save flag)");
          await credManager.deleteCredentials(device.identifier);
        }

        // Disconnect
        await protocolManager.disconnect(companionProtocol, "Pairing complete");

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
            Address: `${device.address}:${device.port}`,
            Credentials: save ? "Saved" : "Not saved",
          });
        }
      } catch (error) {
        output.failSpinner("Pairing failed");
        throw error;
      }
    });
  });
