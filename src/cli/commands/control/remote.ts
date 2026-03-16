import { Command } from "@cliffy/command";
import { JsonStorage } from "@/core/storage/json-storage.ts";
import { connectToDevice } from "@/cli/utils/connection.ts";
import { createOutput } from "@/cli/utils/output.ts";
import { withErrorHandling } from "@/cli/utils/errors.ts";
import type { GlobalOptions } from "@/cli/cli.ts";
import { HidCommandType } from "@/protocols/companion/messages/hidCommand.ts";
import { InputAction } from "@/protocols/types/InputAction.ts";
import type { ControlOptions } from "@/cli/commands/control.ts";

// Button name to HID command mapping
const BUTTON_MAP: Record<string, HidCommandType> = {
  up: HidCommandType.Up,
  down: HidCommandType.Down,
  left: HidCommandType.Left,
  right: HidCommandType.Right,
  menu: HidCommandType.Menu,
  select: HidCommandType.Select,
  home: HidCommandType.Home,
  play: HidCommandType.PlayPause,
  pause: HidCommandType.PlayPause,
  playpause: HidCommandType.PlayPause,
  tv: HidCommandType.Guide,
  guide: HidCommandType.Guide,
  channelup: HidCommandType.ChannelIncrement,
  channeldown: HidCommandType.ChannelDecrement,
  volumeup: HidCommandType.VolumeUp,
  volumedown: HidCommandType.VolumeDown,
  siri: HidCommandType.Siri,
  screensaver: HidCommandType.Screensaver,
  sleep: HidCommandType.Sleep,
  wake: HidCommandType.Wake,
  pageup: HidCommandType.PageUp,
  pagedown: HidCommandType.PageDown,
};

// Human-readable button names for output
const BUTTON_NAMES: Record<string, string> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  menu: "Menu",
  select: "Select",
  home: "Home",
  play: "Play/Pause",
  pause: "Play/Pause",
  playpause: "Play/Pause",
  tv: "TV/Guide",
  guide: "TV/Guide",
  channelup: "Channel Up",
  channeldown: "Channel Down",
  volumeup: "Volume Up",
  volumedown: "Volume Down",
  siri: "Siri",
  screensaver: "Screensaver",
  sleep: "Sleep",
  wake: "Wake",
  pageup: "Page Up",
  pagedown: "Page Down",
};

export const remoteCommand = new Command<GlobalOptions & ControlOptions>()
  .description("Send remote control button presses")
  .arguments("<button:string>")
  .option("--hold", "Hold button (long press)")
  .option("--double", "Double press button")
  .action(async (options, buttonArg: string) => {
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      noColor: options.color,
    });

    // Get device and options from parent command
    const device = (options as unknown as Record<string, unknown>).device as
      | string
      | undefined;
    const hold = (options as unknown as Record<string, unknown>).hold as
      | boolean
      | undefined;
    const double = (options as unknown as Record<string, unknown>).double as
      | boolean
      | undefined;

    if (!device) {
      output.error("Device parameter is required");
      output.info("Usage: bunatv control <device> remote <button>");
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

    // Normalize button name
    const buttonKey = buttonArg.toLowerCase().replace(/[_-]/g, "");

    // Validate button
    if (!BUTTON_MAP[buttonKey]) {
      output.error(`Unknown button: ${buttonArg}`);
      output.info("Available buttons:");
      output.info("  Navigation: up, down, left, right, menu, select, home");
      output.info("  Media: play, pause, tv, guide");
      output.info("  Channels: channelUp, channelDown");
      output.info("  Volume: volumeUp, volumeDown");
      output.info("  Other: siri, screensaver, sleep, wake, pageUp, pageDown");
      process.exit(1);
    }

    const hidCommand = BUTTON_MAP[buttonKey];
    const buttonName = BUTTON_NAMES[buttonKey];

    // Determine input action
    let action: InputAction = InputAction.Single;
    let actionDesc = "press";

    if (hold && double) {
      output.error("Cannot use both --hold and --double options");
      process.exit(1);
    }

    if (hold) {
      action = InputAction.Hold;
      actionDesc = "hold";
    } else if (double) {
      action = InputAction.Double;
      actionDesc = "double press";
    }

    await withErrorHandling(output, async () => {
      // Connect to device
      const storage = new JsonStorage();
      const deviceApi = await connectToDevice(device, storage, {
        timeout: timeout * 1000,
        autoRecover: autoRecover,
      });
      const companion = deviceApi.companion();

      try {
        output.startSpinner(`Sending ${buttonName} ${actionDesc}...`);

        // Send button press with action
        await companion.input.pressButton(hidCommand, action);

        output.succeedSpinner(`${buttonName} ${actionDesc} sent`);

        if (outputFormat === "json") {
          output.result({
            success: true,
            button: buttonArg,
            action: actionDesc,
            timestamp: new Date().toISOString(),
          });
        } else {
          output.success(`✅ ${buttonName} ${actionDesc} sent successfully`);
        }
      } finally {
        await deviceApi.disconnect();
      }
    });
  });
