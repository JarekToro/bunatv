import { Command } from "@cliffy/command";
import { JsonStorage } from "@/core/storage/json-storage.ts";
import { connectToDevice } from "@/cli/utils/connection.ts";
import { createOutput } from "@/cli/utils/output.ts";
import { withErrorHandling } from "@/cli/utils/errors.ts";
import type { GlobalOptions } from "@/cli/cli.ts";
import type { DebugOptions } from "@/cli/commands/debug.ts";

import { type DeviceState } from "@/protocols/types/DeviceState.ts";

interface DebugState {
  volume: number;
  systemState: DeviceState;
  textInput: {
    documentText: string;
    cursorPosition: number;
    selectionLength: number;
    isSecure: boolean;
    autoCorrection: boolean;
  };
  mediaControls: unknown[];
  lastTouch: {
    x: number;
    y: number;
    phase: number;
    phaseName: string;
    fingerId: number;
    timestamp: number;
  };
}

// ANSI escape codes for terminal control
const CLEAR_SCREEN = "\x1b[2J";
const MOVE_TO_TOP = "\x1b[H";

function renderState(state: Partial<DebugState>): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════");
  lines.push("              COMPANION STATE");
  lines.push("═══════════════════════════════════════════════════");
  lines.push("");

  // Volume
  lines.push(`📊 Volume: ${state.volume ?? "N/A"}`);
  lines.push("");

  // System State
  lines.push("🖥️  System State:");
  if (state.systemState) {
    lines.push(`   ${state.systemState}`);
  } else {
    lines.push("   (none)");
  }
  lines.push("");

  // Text Input
  lines.push("⌨️  Text Input:");
  if (state.textInput) {
    lines.push(
      `   Document: "${state.textInput.documentText.slice(0, 50)}${state.textInput.documentText.length > 50 ? "..." : ""}"`
    );
    lines.push(
      `   Cursor: ${state.textInput.cursorPosition}, Selection: ${state.textInput.selectionLength}`
    );
    lines.push(
      `   Secure: ${state.textInput.isSecure}, AutoCorrect: ${state.textInput.autoCorrection}`
    );
  } else {
    lines.push("   (none)");
  }
  lines.push("");

  // Media Controls
  lines.push("🎵 Media Controls:");
  if (state.mediaControls?.length) {
    for (const control of state.mediaControls) {
      lines.push(`   - ${JSON.stringify(control)}`);
    }
  } else {
    lines.push("   (none)");
  }
  lines.push("");

  // Last Touch
  lines.push("👆 Last Touch:");
  if (state.lastTouch) {
    lines.push(
      `   Position: (${state.lastTouch.x.toFixed(2)}, ${state.lastTouch.y.toFixed(2)})`
    );
    lines.push(
      `   Phase: ${state.lastTouch.phaseName} (${state.lastTouch.phase})`
    );
    lines.push(`   Finger: ${state.lastTouch.fingerId}`);
    lines.push(`   Time: ${new Date(state.lastTouch.timestamp).toISOString()}`);
  } else {
    lines.push("   (none)");
  }
  lines.push("");
  lines.push("───────────────────────────────────────────────────");
  lines.push(`Last updated: ${new Date().toISOString()}`);

  return lines.join("\n");
}

function clearAndRender(content: string): void {
  // Move cursor to top-left and clear screen
  process.stdout.write(MOVE_TO_TOP + CLEAR_SCREEN);
  process.stdout.write(content + "\n");
}

export const interestCommand = new Command<GlobalOptions & DebugOptions>()
  .description("Debug interest subscriptions and events")
  .action(async (options) => {
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      noColor: options.color,
    });

    const device = (options as unknown as Record<string, unknown>).device as
      | string
      | undefined;
    if (!device) {
      output.error("Device parameter is required");
      process.exit(1);
    }

    const timeout =
      ((options as unknown as Record<string, unknown>).timeout as
        | number
        | undefined) ?? 10;

    await withErrorHandling(output, async () => {
      const storage = new JsonStorage();
      const deviceApi = await connectToDevice(device, storage, {
        timeout: timeout * 1000,
        autoRecover: true,
      });
      const companion = deviceApi.companion();

      // Initial render
      clearAndRender(`Connected to ${device}\nWaiting for state changes...`);

      const state: Partial<DebugState> = {};

      companion.audio.on("volumeChanged", (volume: number) => {
        state.volume = volume;
        clearAndRender(renderState(state));
      });

      companion.power.on("stateChanged", (deviceState: DeviceState) => {
        state.systemState = deviceState;
        clearAndRender(renderState(state));
      });

      await companion.audio.toggleMute();

      // Handle graceful shutdown
      process.on("SIGINT", () => {
        console.log("\nExiting...");
        process.exit(0);
      });

      await new Promise(() => {});
    });
  });
