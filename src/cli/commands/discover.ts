/**
 * Discover command - Find Apple TV devices on the network
 */

import { Command } from "@cliffy/command";
import { discoverDevices } from "@/cli/utils/device-lookup.ts";
import { CredentialManager } from "@/cli/core/credential-manager.ts";
import { JsonStorage } from "@/core/storage/json-storage.ts";
import { createOutput } from "../utils/output";
import { withErrorHandling } from "../utils/errors";
import type { GlobalOptions } from "@/cli/cli.ts";
import type { AppleDevice } from "@/core/discovery/discovery-types.ts";

function getDevicePort(device: AppleDevice): number {
  return (
    device.services.airPlay?.port ?? device.services.companionLink?.port ?? 0
  );
}

function getDeviceProtocols(device: AppleDevice): string[] {
  const protocols: string[] = [];
  if (device.services.airPlay) protocols.push("airplay");
  if (device.services.companionLink) protocols.push("companion");
  if (device.services.raop) protocols.push("raop");
  return protocols;
}

export const discoverCommand = new Command<GlobalOptions>()
  .description("Discover Apple TV devices on the network")
  .option("-t, --timeout <seconds:number>", "Discovery timeout in seconds", {
    default: 5,
  })
  .option("-f, --filter <text:string>", "Filter devices by name or identifier")
  .option("--companion-only", "Show only Companion-capable devices", {
    default: false,
  })
  .action(async (options) => {
    const { timeout, filter, companionOnly } = options;
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      noColor: options.color,
    });

    await withErrorHandling(output, async () => {
      output.status("🔍", "Discovering Apple TV devices...");
      output.debug(`Timeout: ${timeout} seconds`);

      if (filter) {
        output.debug(`Filter: ${filter}`);
      }

      // Start discovery
      output.startSpinner("Scanning network for Apple TV devices");

      let devices = await discoverDevices(timeout);

      // Filter to Companion-capable devices if requested
      if (companionOnly) {
        devices = devices.filter((d) => d.services.companionLink !== undefined);
      }

      // Apply name/ID filter if provided
      if (filter) {
        const filterLower = filter.toLowerCase();
        devices = devices.filter(
          (d) =>
            d.name.toLowerCase().includes(filterLower) ||
            d.identifier.toLowerCase().includes(filterLower) ||
            d.address.includes(filter)
        );
      }

      // Check pairing status for each device
      const storage = new JsonStorage();
      const credManager = new CredentialManager(storage);

      const devicesWithStatus = await Promise.all(
        devices.map(async (device) => ({
          ...device,
          paired: await credManager.hasCredentials(
            device.identifier,
            "companion"
          ),
        }))
      );

      // Stop spinner with result
      if (devicesWithStatus.length > 0) {
        output.succeedSpinner(`Found ${devicesWithStatus.length} device(s)`);
      } else {
        output.failSpinner("No devices found");
      }

      // Output results
      if (devicesWithStatus.length === 0) {
        if (options.output === "json") {
          output.result([]);
        } else {
          output.info("No Apple TV devices found on the network");
          output.info("\nTroubleshooting:");
          output.info("  • Check devices are powered on");
          output.info("  • Check devices are on same network");
          output.info("  • Check firewall allows mDNS (port 5353)");
        }
      } else {
        // Format output based on format
        if (options.output === "table") {
          const tableData = devicesWithStatus.map((d) => ({
            Name: d.name,
            Address: `${d.address}:${getDevicePort(d)}`,
            Protocols: getDeviceProtocols(d).join(", "),
            Model: d.model || "Unknown",
            Paired: d.paired ? "✓" : "✗",
          }));
          output.result(tableData);
        } else if (options.output === "text") {
          const formattedDevices = devicesWithStatus.map((device) => {
            const info: Record<string, string> = {
              "📺 Name": device.name,
              Identifier: device.identifier,
              Address: `${device.address}:${getDevicePort(device)}`,
              Protocols: getDeviceProtocols(device).join(", "),
              Paired: device.paired ? "✓ Yes" : "✗ No",
            };

            if (options.verbose) {
              info["Model"] = device.model || "Unknown";
              info["OS Version"] =
                device.services.airPlay?.txt.osvers || "Unknown";
              const deviceId = device.services.airPlay?.txt.deviceid;
              if (deviceId) {
                info["Device ID"] = deviceId;
              }
              if (device.services.companionLink) {
                info["Companion Port"] =
                  device.services.companionLink.port.toString();
              }
            }

            return info;
          });
          output.result(formattedDevices);
        } else {
          // JSON format
          output.result(devicesWithStatus);
        }
      }
    });
  });
