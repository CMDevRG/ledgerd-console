import type { LogLevel } from './config';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * One JSON object per line. Callers pass only the fields they mean to log; values that
 * are `Secret`s serialise as [REDACTED] on their own.
 */
export function createLogger(level: LogLevel, write: (line: string) => void): Logger {
  const emit = (at: LogLevel, message: string, fields: Record<string, unknown> = {}): void => {
    if (ORDER[at] < ORDER[level]) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: at, msg: message, ...fields }));
  };
  return {
    debug: (m, f) => {
      emit('debug', m, f);
    },
    info: (m, f) => {
      emit('info', m, f);
    },
    warn: (m, f) => {
      emit('warn', m, f);
    },
    error: (m, f) => {
      emit('error', m, f);
    },
  };
}
