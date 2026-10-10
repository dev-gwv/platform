/**
 * Structured JSON logger, one line per event, pino-shaped ({level, time, msg,
 * ...fields}) so any collector that understands pino understands this. No
 * dependency: the API runs under Bun on a VPS where stdout IS the log pipeline.
 *
 * Level comes from LOG_LEVEL (default 'info'); anything below it is dropped.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 20, info: 30, warn: 40, error: 50 }

let threshold: number = LEVELS.info

export function setLogLevel(level: string | undefined): void {
  threshold = LEVELS[(level ?? 'info') as LogLevel] ?? LEVELS.info
}

interface LogFields {
  [key: string]: unknown
}

function emit(level: LogLevel, fields: LogFields, msg?: string): void {
  if (LEVELS[level] < threshold) return
  const line = JSON.stringify({
    level: LEVELS[level],
    levelName: level,
    time: new Date().toISOString(),
    service: 'ipc-api',
    ...(msg ? { msg } : {}),
    ...fields,
  })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (fields: LogFields, msg?: string) => emit('debug', fields, msg),
  info: (fields: LogFields, msg?: string) => emit('info', fields, msg),
  warn: (fields: LogFields, msg?: string) => emit('warn', fields, msg),
  error: (fields: LogFields, msg?: string) => emit('error', fields, msg),
}

/** The loggable shape of an unknown thrown value. */
export function describeError(err: unknown): {
  message: string
  code: string | undefined
  stack: string | undefined
} {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    return {
      message: err.message,
      code: typeof code === 'string' ? code : undefined,
      stack: err.stack,
    }
  }
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; code?: unknown }
    return {
      message: typeof o.message === 'string' ? o.message : JSON.stringify(err).slice(0, 500),
      code: typeof o.code === 'string' ? o.code : undefined,
      stack: undefined,
    }
  }
  return { message: String(err), code: undefined, stack: undefined }
}
