/**
 * Info command - Get detailed info about a specific device
 */

import { Command } from "@cliffy/command";
import { findDevice, DeviceNotFoundError } from "@/cli/utils/device-lookup.ts";
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
      output.status("🔍", `Searching for device: ${identifier}...`);

      const startTime = performance.now();
      let device;
      try {
        device = await findDevice(identifier);
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

        const protocols: string[] = [];
        if (device.services.airPlay) protocols.push("airplay");
        if (device.services.companionLink) protocols.push("companion");
        if (device.services.raop) protocols.push("raop");

        const port =
          device.services.airPlay?.port ??
          device.services.companionLink?.port ??
          0;

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
          output.info(`   Address: ${device.address}:${port}`);
          output.info(
            `   OS Version: ${device.services.airPlay?.txt.osvers || "Unknown"}`
          );
          output.info(`   Protocols: ${protocols.join(", ")}`);

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
