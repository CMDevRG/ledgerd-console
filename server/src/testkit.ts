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
    allowedHosts: ['localhost:8787', '127.0.0.1:8787'],
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

/** The Host header a browser would send for the console in its default configuration. */
export const HOST = 'localhost:8787';

/** What the console's own page sends with every state-changing call. */
export const CONSOLE_HEADERS = {
  'X-Ledgerd-Console': '1',
  Origin: 'http://localhost:8787',
} as const;

interface Requestable {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

/** Sends a request to an app in-process, with the Host header a browser would add. */
export function send(app: Requestable, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Host')) headers.set('Host', HOST);
  return Promise.resolve(app.request(path, { ...init, headers }));
}

/**
 * Wraps an app so that `app.request(...)` adds the Host header by default. Everything
 * else (routes, middleware) is the real app, so tests can still register routes on it.
 */
export function withHost<T extends Requestable>(app: T): T {
  return new Proxy(app, {
    get(target, property, receiver) {
      if (property === 'request')
        return (path: string, init?: RequestInit) => send(target, path, init);
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
