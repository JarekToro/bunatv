import pino, { type Logger, type LevelWithSilent } from 'pino'
import * as process from 'node:process'
/**
 * Custom log level for HAP debugging
 */
// const LOG_LEVEL = process.env.LOG_LEVEL || 'trace';

function getDEBUG() {
  return process.env.DEBUG || '*'
}

function getLogLevel() {
  return process.env.LOG_LEVEL || 'silent'
}

let _baseLogger: pino.Logger | null = null

const getBaseLogger = () => {
  if (_baseLogger) {
    return _baseLogger
  }
  _baseLogger = pino({
    level: getLogLevel(),
    transport: {
      target: new URL('./pretty-pino-transport', import.meta.url).href,
      options: {
        colorize: true,
        ignore: 'pid,hostname,module',
        translateTime: 'HH:MM:ss.l',
        errorLikeObjectKeys: ['err', 'error'],
        singleLine: true,
      },
    },
  })

  return _baseLogger
}
// create noops logger for empty logging
const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
} as unknown as Logger

const nameSpaceCache = {
  modules: '',
  names: [] as string[],
  skips: [] as string[],
  loaded: false,
}
function loadEnabledModules(modules: string) {
  if (nameSpaceCache.loaded && nameSpaceCache.modules === modules) {
    return
  }
  nameSpaceCache.modules = modules

  nameSpaceCache.names = []
  nameSpaceCache.skips = []

  const split = modules.trim().replace(/\s+/g, ',').split(',').filter(Boolean)

  for (const mod of split) {
    if (mod[0] === '-') {
      nameSpaceCache.skips.push(mod.slice(1))
    } else {
      nameSpaceCache.names.push(mod)
    }
  }
  nameSpaceCache.loaded = true
}

function moduleEnabled(module: string): boolean {
  for (const skip of nameSpaceCache.skips) {
    if (matchesTemplate(module, skip)) {
      return false
    }
  }

  for (const ns of nameSpaceCache.names) {
    if (matchesTemplate(module, ns)) {
      return true
    }
  }

  return false
}

function matchesTemplate(search: string, template: string) {
  let searchIndex = 0
  let templateIndex = 0
  let starIndex = -1
  let matchIndex = 0

  while (searchIndex < search.length) {
    if (
      templateIndex < template.length &&
      (template[templateIndex] === search[searchIndex] || template[templateIndex] === '*')
    ) {
      // Match character or proceed with wildcard
      if (template[templateIndex] === '*') {
        starIndex = templateIndex
        matchIndex = searchIndex
        templateIndex++ // Skip the '*'
      } else {
        searchIndex++
        templateIndex++
      }
    } else if (starIndex !== -1) {
      // Backtrack to the last '*' and try to match more characters
      templateIndex = starIndex + 1
      matchIndex++
      searchIndex = matchIndex
    } else {
      return false // No match
    }
  }

  // Handle trailing '*' in template
  while (templateIndex < template.length && template[templateIndex] === '*') {
    templateIndex++
  }

  return templateIndex === template.length
}

const initializedLoggers = new Set<pino.Logger>()

export function setGlobalLogLevel(level: LevelWithSilent) {
  getBaseLogger().level = level
  initializedLoggers.forEach(logger => {
    logger.level = level
  })
}
// Factory function for creating child loggers with enhanced capabilities

export function createLogger(module: string, parent?: pino.Logger): pino.Logger {
  loadEnabledModules(getDEBUG())
  const loggerModule = `${parent?.bindings()?.module ? parent?.bindings()?.module + ':' : ''}${module}`
  if (!moduleEnabled(loggerModule)) {
    return noopLogger
  }
  const logger = getBaseLogger().child({ module: loggerModule })
  initializedLoggers.add(logger)
  return logger
}
