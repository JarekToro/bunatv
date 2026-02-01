import { Command } from "@cliffy/command";
import type { GlobalOptions } from "@/cli/cli.ts";
import { volumeCommand } from "./control/volume.ts";
import { remoteCommand } from "./control/remote.ts";
import { powerCommand } from "./control/power.ts";

export type ControlOptions =
  typeof _controlCommand extends Command<
    void,
    void,
    void,
    [],
    infer Options extends Record<string, unknown>
  >
    ? Options
    : never;

const _controlCommand = new Command<GlobalOptions>()
  .description("Control an Apple TV device")
  .globalOption(
    "-d, --device <identifier:string>",
    "Device identifier, IP address, or name",
    {
      required: true,
    }
  )
  .globalOption(
    "-t, --timeout <seconds:number>",
    "Connection timeout in seconds",
    { default: 10 }
  )
  .globalOption("--no-auto-recover", "Disable automatic connection recovery", {
    default: false,
  });

export const controlCommand = _controlCommand
  .command("volume", volumeCommand)
  .command("remote", remoteCommand)
  .command("power", powerCommand);
