#!/usr/bin/env bun
/**
 * BunATV CLI - Apple TV control from the command line
 */

import { Command, EnumType } from '@cliffy/command'

import { CompletionsCommand } from '@jsr/cliffy__command/completions'
import type { LevelWithSilent } from 'pino'
import { discoverCommand } from './commands/discover'
import { pairCommand } from './commands/pair'
import { wizardCommand } from './commands/wizard'
import { infoCommand } from './commands/info'
import { controlCommand } from './commands/control'
import process from 'node:process'
import { setGlobalLogLevel } from '@/logging/logging.ts'
import { debugCommand } from './commands/debug'

export type OutputFormat = 'text' | 'json' | 'table'

const outputFormatType = new EnumType<OutputFormat>(['text', 'json', 'table'] as const)

const logLevelType = new EnumType<LevelWithSilent>([
  'silent',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const)

export type GlobalOptions =
  typeof cli extends Command<void, void, void, [], infer Options extends Record<string, unknown>>
    ? Options
    : never

// Main CLI command with global options
const cli = new Command()
  .globalType('outputFormat', outputFormatType)
  .globalType('logLevelType', logLevelType)
  .name('bunatv')
  .version('1.0.0')
  .description('Control Apple TV devices from the command line')
  // Global options available to all commands
  .globalOption('-o, --output <format:outputFormat>', 'Output format (text, json, table)', {
    default: 'text',
  })
  .globalOption('-v, --verbose', 'Verbose output with detailed information', { default: false })
  .globalOption('--no-color', 'Disable colored output', { default: false })
  .globalOption(
    '--debug [level:logLevelType]',
    'Set logging level (silent, error, warn, info, debug, trace)',
    { equalsSign: true }
  )
  .globalAction(options => {
    setGlobalLogLevel(options.debug === true ? 'debug' : options.debug ?? 'silent')
  })

const entry = cli
  .command('discover', discoverCommand)
  .command('info', infoCommand)
  .command('pair', pairCommand)
  .command('wizard', wizardCommand)
  .command('control', controlCommand)
  .command('debug', debugCommand)
  .command('completions', new CompletionsCommand())

// Parse and run
if (import.meta.main) {
  await entry.parse(process.argv.slice(2))
}
