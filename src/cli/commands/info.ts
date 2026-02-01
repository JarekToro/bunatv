/**
 * Info command - Get detailed info about a specific device
 */

import { Command } from "@cliffy/command";
import {
  DeviceManager,
  DeviceNotFoundError,
} from "@/cli/core/device-manager.ts";
import { createOutput } from "../utils/output";
import { withErrorHandling } from "../utils/errors";
import type { GlobalOptions } from "@/cli/cli.ts";

export const infoCommand = new Command<GlobalOptions>()
  .description("Get detailed information about a specific device")
  .arguments("<identifier:string>")
  .action(async (options, identifier) => {
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      noColor: options.color,
    });

    await withErrorHandling(output, async () => {
      const deviceManager = new DeviceManager();

      output.status("🔍", `Searching for device: ${identifier}...`);

      const startTime = performance.now();
      let device;
      try {
        device = await deviceManager.findDevice(identifier);
      } catch (error) {
        if (error instanceof DeviceNotFoundError) {
          output.failSpinner(`Device not found: ${identifier}`);
          return;
        }
        throw error;
      }
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);

      if (device) {
        output.succeedSpinner(`Found device in ${duration}ms`);

        if (options.output === "json") {
          output.result({
            device,
            lookupTimeMs: parseFloat(duration),
          });
        } else {
          output.info(`\n📱 Device Information:`);
          output.info(`   Name: ${device.name}`);
          output.info(`   Model: ${device.model || "Unknown"}`);
          output.info(`   ID: ${device.identifier}`);
          output.info(`   Address: ${device.address}:${device.port}`);
          output.info(`   OS Version: ${device.osVersion || "Unknown"}`);
          output.info(`   Protocols: ${device.protocols.join(", ")}`);

          output.info(`\n⏱️  Lookup Speed: ${duration}ms`);
          if (parseFloat(duration) < 50) {
            output.info(`   (⚡️ Loaded from cache)`);
          } else {
            output.info(`   (🌐 Performed network discovery)`);
          }
        }
      }
    });
  });
