import { Command } from "@cliffy/command";
import { JsonStorage } from "@/core/storage/json-storage.ts";
import { connectToDevice } from "@/cli/utils/connection.ts";
import { createOutput } from "@/cli/utils/output.ts";
import { withErrorHandling } from "@/cli/utils/errors.ts";
import type { GlobalOptions } from "@/cli/cli.ts";
import { HidCommandType } from "@/protocols/companion/messages/hidCommand.ts";
import { InputAction } from "@/protocols/types/InputAction.ts";
import { DeviceState } from "@/protocols/types/DeviceState.ts";
import type { ControlOptions } from "@/cli/commands/control.ts";

export const powerCommand = new Command<GlobalOptions & ControlOptions>()
  .description("Manage device power state")
  .arguments("<action:string>")
  .action(async (options, action: string) => {
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      noColor: options.color,
    });

    // Get device from parent command
    const device = options.device;

    // Get timeout and autoRecover from options
    const timeout = options.timeout;
    const autoRecover = options.autoRecover;
    const outputFormat = options.output;

    await withErrorHandling(output, async () => {
      // Connect to device
      const storage = new JsonStorage();
      const deviceApi = await connectToDevice(device, storage, {
        timeout: timeout * 1000,
        autoRecover: autoRecover,
      });
      const companion = deviceApi.companion();

      try {
        switch (action.toLowerCase()) {
          case "get":
          case "status": {
            output.startSpinner("Getting device state...");
            const state = await companion.power.getDeviceState();
            output.succeedSpinner(`Device State: ${state}`);

            if (outputFormat === "json") {
              output.result({
                deviceState: state,
                value: state,
              });
            } else {
              output.result({
                "🔋 Device State": state,
              });
            }
            break;
          }

          case "wake": {
            output.startSpinner("Waking device...");
            await companion.input.pressButton(
              HidCommandType.Wake,
              InputAction.Single
            );
            output.succeedSpinner("Device wake command sent");

            if (outputFormat === "json") {
              output.result({
                success: true,
                action: "wake",
                timestamp: new Date().toISOString(),
              });
            } else {
              output.success("✅ Device woken");
            }
            break;
          }

          case "sleep": {
            output.startSpinner("Putting device to sleep...");
            await companion.input.pressButton(
              HidCommandType.Sleep,
              InputAction.Single
            );
            output.succeedSpinner("Device sleep command sent");

            if (outputFormat === "json") {
              output.result({
                success: true,
                action: "sleep",
                timestamp: new Date().toISOString(),
              });
            } else {
              output.success("✅ Device sleeping");
            }
            break;
          }

          default:
            output.error(`Unknown power action: ${action}`);
            output.info("Available actions: get, wake, sleep");
            process.exit(1);
        }
      } finally {
        await deviceApi.disconnect();
      }
    });
  });
