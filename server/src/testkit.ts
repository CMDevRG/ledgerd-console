import type { Config } from './config';
import { Secret } from './secret';
import { createLogger, type Logger } from './logger';

export const TEST_KEY = 'test-api-key-0123456789-abcdef';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ledgerdUrl: new URL('http://127.0.0.1:8085'),
    apiKey: new Secret(TEST_KEY),
    host: '127.0.0.1',
    port: 0,
    allowedHosts: ['localhost:8787', '127.0.0.1:8787', 'localhost', 'localhost:0'],
    allowedOrigins: ['http://localhost:8787', 'http://127.0.0.1:8787'],
    logLevel: 'debug',
    ...overrides,
  };
}

/** A logger that keeps its lines, so tests can inspect exactly what would be written. */
export function captureLogger(): {
  logger: Logger;
  lines: () => Record<string, unknown>[];
  raw: () => string;
} {
  const written: string[] = [];
  return {
    logger: createLogger('debug', (line) => written.push(line)),
    lines: () => written.map((l) => JSON.parse(l) as Record<string, unknown>),
    raw: () => written.join('\n'),
  };
}
