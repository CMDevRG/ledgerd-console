import { describe, expect, it } from 'vitest';

import { devEnvironment, WEB_PORT } from './dev-env';

const KEY = 'a-long-enough-api-key-0123456789';

function ok(env: Record<string, string | undefined>) {
  const result = devEnvironment(env);
  if (!result.ok) throw new Error(`unexpected errors: ${result.errors.join('; ')}`);
  return result;
}

describe('devEnvironment', () => {
  it('accepts the Vite host and origin as well as its own', () => {
    const { server } = ok({ LEDGERD_API_KEY: KEY });
    expect(server.CONSOLE_ALLOWED_HOSTS?.split(',')).toEqual([
      'localhost:8787',
      '127.0.0.1:8787',
      `localhost:${String(WEB_PORT)}`,
      `127.0.0.1:${String(WEB_PORT)}`,
    ]);
    expect(server.CONSOLE_ALLOWED_ORIGINS?.split(',')).toEqual([
      'http://localhost:8787',
      'http://127.0.0.1:8787',
      `http://localhost:${String(WEB_PORT)}`,
      `http://127.0.0.1:${String(WEB_PORT)}`,
    ]);
  });

  it('points Vite at the console server, wherever that is configured to listen', () => {
    expect(ok({ LEDGERD_API_KEY: KEY }).web.CONSOLE_SERVER_URL).toBe('http://127.0.0.1:8787');
    expect(
      ok({ LEDGERD_API_KEY: KEY, CONSOLE_ADDR: '127.0.0.1:9100' }).web.CONSOLE_SERVER_URL,
    ).toBe('http://127.0.0.1:9100');
  });

  it('follows a different console port in the allowed hosts', () => {
    const { server } = ok({ LEDGERD_API_KEY: KEY, CONSOLE_ADDR: '127.0.0.1:9100' });
    expect(server.CONSOLE_ALLOWED_HOSTS).toContain('localhost:9100');
  });

  it('respects an explicit allow-list instead of extending it', () => {
    const { server } = ok({
      LEDGERD_API_KEY: KEY,
      CONSOLE_ALLOWED_HOSTS: 'localhost:5173',
      CONSOLE_ALLOWED_ORIGINS: 'http://localhost:5173',
    });
    expect(server.CONSOLE_ALLOWED_HOSTS).toBe('localhost:5173');
    expect(server.CONSOLE_ALLOWED_ORIGINS).toBe('http://localhost:5173');
  });

  it('logs at debug level unless told otherwise', () => {
    expect(ok({ LEDGERD_API_KEY: KEY }).server.CONSOLE_LOG_LEVEL).toBe('debug');
    expect(ok({ LEDGERD_API_KEY: KEY, CONSOLE_LOG_LEVEL: 'warn' }).server.CONSOLE_LOG_LEVEL).toBe(
      'warn',
    );
  });

  it('keeps the rest of the environment, and gives Vite no extra access to the key', () => {
    const { server, web } = ok({
      LEDGERD_API_KEY: KEY,
      PATH: '/usr/bin',
      LEDGERD_URL: 'http://ledgerd:8085',
    });
    expect(server.PATH).toBe('/usr/bin');
    expect(server.LEDGERD_URL).toBe('http://ledgerd:8085');
    // Vite exposes only VITE_-prefixed variables to the browser, so the key cannot reach the
    // bundle; this guards the naming that keeps it that way.
    expect(Object.keys(web).filter((k) => k.startsWith('VITE_') && web[k]?.includes(KEY))).toEqual(
      [],
    );
  });

  it('says how to fix a missing key, without inventing one', () => {
    const result = devEnvironment({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('.env.local');
    }
  });

  it('reports other configuration errors and never echoes the key', () => {
    const result = devEnvironment({
      LEDGERD_API_KEY: KEY,
      LEDGERD_URL: 'ftp://nope',
      CONSOLE_ADDR: 'nonsense',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(result.errors)).not.toContain(KEY);
    }
  });
});
