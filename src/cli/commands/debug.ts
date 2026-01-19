import { Command } from '@cliffy/command'
import type { GlobalOptions } from '@/cli/cli.ts'
import { interestCommand } from './debug/interest.ts'

export type DebugOptions =
  typeof _debugCommand extends Command<
    void,
    void,
    void,
    [],
    infer Options extends Record<string, unknown>
  >
    ? Options
    : never

const _debugCommand = new Command<GlobalOptions>()
  .description('Debug utilities for BunATV')
  .globalOption('-d, --device <identifier:string>', 'Device identifier, IP address, or name', {
    required: true,
  })
  .globalOption('-t, --timeout <seconds:number>', 'Connection timeout in seconds', { default: 10 })

export const debugCommand = _debugCommand.command('interest', interestCommand)
