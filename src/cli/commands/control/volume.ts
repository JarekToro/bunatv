import { Command } from "@cliffy/command";
import { JsonStorage } from "@/core/storage/json-storage.ts";
import { connectToDevice } from "@/cli/utils/connection.ts";
import { createOutput } from "@/cli/utils/output.ts";
import { withErrorHandling } from "@/cli/utils/errors.ts";
import type { GlobalOptions } from "@/cli/cli.ts";
import { HidCommandType } from "@/protocols/companion/messages/hidCommand.ts";
import { InputAction } from "@/protocols/companion/messages/CompanionOpackMessage.ts";
import { sleep } from "@/core/utils/timing.ts";
import type { ControlOptions } from "@/cli/commands/control.ts";

export const volumeCommand = new Command<GlobalOptions & ControlOptions>()
  .description("Control device volume")
  .arguments("<action:string> [value:number]")
  .action(async (options, action: string, value?: number) => {
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      noColor: options.color,
    });

    // Get device from parent command - will be passed down from control command
    const device = (options as unknown as Record<string, unknown>).device as
      | string
      | undefined;

    if (!device) {
      output.error("Device parameter is required");
      output.info("Usage: bunatv control <device> volume <action>");
      process.exit(1);
    }

    // Get timeout and autoRecover from options
    const timeout =
      ((options as unknown as Record<string, unknown>).timeout as
        | number
        | undefined) ?? 10;
    const autoRecover =
      ((options as unknown as Record<string, unknown>).autoRecover as
        | boolean
        | undefined) ?? true;
    const outputFormat = String(options.output);

    await withErrorHandling(output, async () => {
      // Connect to device
      const storage = new JsonStorage();
      const protocol = await connectToDevice(device, storage, {
        timeout: timeout * 1000,
        autoRecover: autoRecover,
      });

      try {
        switch (action.toLowerCase()) {
          case "get": {
            output.startSpinner("Getting volume...");
            const volume = await protocol.getVolume();
            output.succeedSpinner(`Volume: ${volume}`);

            if (outputFormat === "json") {
              output.result({ volume });
            } else {
              output.result({ "🔊 Volume": `${volume}%` });
            }
            break;
          }

          case "set": {
            if (value === undefined) {
              output.error("Volume level required for set command");
              output.info("Usage: bunatv control <device> volume set <0-100>");
              process.exit(1);
            }

            if (value < 0 || value > 100) {
              output.error("Volume must be between 0 and 100");
              process.exit(1);
            }

            output.startSpinner(`Setting volume to ${value}%...`);
            await protocol.setVolume(value / 100);
            output.succeedSpinner(`Volume set to ${value}%`);

            if (outputFormat === "json") {
              output.result({ volume: value, success: true });
            } else {
              output.success(`✅ Volume set to ${value}%`);
            }
            break;
          }

          case "up": {
            const step = value;
            if (step == undefined) {
              await protocol.pressButton(
                HidCommandType.VolumeUp,
                InputAction.Single
              );
              output.success("✅ Volume increased by 1 step");
              break;
            }
            output.startSpinner("Increasing volume...");
            const currentVolume = await protocol.getVolume();
            const newVolume = Math.min(100, currentVolume + step);
            await protocol.setVolume(newVolume / 100);
            output.succeedSpinner(`Volume: ${currentVolume}% → ${newVolume}%`);
            break;
          }

          case "down": {
            const step = value;
            if (step == undefined) {
              await protocol.pressButton(
                HidCommandType.VolumeDown,
                InputAction.Single
              );
              output.success("✅ Volume decreased by 1 step");
              break;
            }
            output.startSpinner("Decreasing volume...");
            const currentVolume = await protocol.getVolume();
            const newVolume = Math.max(0, currentVolume - step);
            await protocol.setVolume(newVolume / 100);
            output.succeedSpinner(`Volume: ${currentVolume}% → ${newVolume}%`);
            break;
          }

          default:
            output.error(`Unknown volume action: ${action}`);
            output.info("Available actions: get, set, up, down");
            process.exit(1);
        }
      } finally {
        await protocol.disconnect();
        process.exit(0);
      }
    });
  });
