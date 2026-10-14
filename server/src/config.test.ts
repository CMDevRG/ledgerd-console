import { describe, expect, it } from 'vitest';

import { isLoopback, loadConfig, type Config } from './config';

const KEY = 'a-long-enough-api-key-0123456789';
const valid = { LEDGERD_API_KEY: KEY };

function ok(env: Record<string, string | undefined>): Config {
  const result = loadConfig(env);
  if (!result.ok) throw new Error(`unexpected errors: ${result.errors.join('; ')}`);
  return result.config;
}

function errors(env: Record<string, string | undefined>): string[] {
  const result = loadConfig(env);
  if (result.ok) throw new Error('expected configuration errors');
  return result.errors;
}

describe('loadConfig', () => {
  it('has safe defaults: loopback only, ledgerd on its usual port', () => {
    const config = ok(valid);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.ledgerdUrl.href).toBe('http://127.0.0.1:8085/');
    expect(config.allowedHosts).toEqual(['localhost:8787', '127.0.0.1:8787']);
    expect(config.allowedOrigins).toEqual(['http://localhost:8787', 'http://127.0.0.1:8787']);
    expect(config.logLevel).toBe('info');
    expect(config.apiKey.reveal()).toBe(KEY);
  });

  it('derives the allowed hosts and origins from the port', () => {
    const config = ok({ ...valid, CONSOLE_ADDR: '127.0.0.1:9000' });
    expect(config.allowedHosts).toEqual(['localhost:9000', '127.0.0.1:9000']);
    expect(config.allowedOrigins).toEqual(['http://localhost:9000', 'http://127.0.0.1:9000']);
  });

  it('accepts explicit lists, trimming spaces', () => {
    const config = ok({
      ...valid,
      CONSOLE_ALLOWED_HOSTS: 'localhost:5173, 127.0.0.1:5173',
      CONSOLE_ALLOWED_ORIGINS: 'http://localhost:5173 , http://127.0.0.1:5173',
      CONSOLE_LOG_LEVEL: 'DEBUG',
      LEDGERD_URL: 'https://ledger.internal:8443',
    });
    expect(config.allowedHosts).toEqual(['localhost:5173', '127.0.0.1:5173']);
    expect(config.allowedOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(config.logLevel).toBe('debug');
    expect(config.ledgerdUrl.origin).toBe('https://ledger.internal:8443');
  });

  it.each<[string, Record<string, string>, RegExp]>([
    ['a missing key', {}, /LEDGERD_API_KEY is required/],
    ['a short key', { LEDGERD_API_KEY: 'too-short' }, /at least 16/],
    ['a bad ledgerd url', { ...valid, LEDGERD_URL: 'ledgerd:8085' }, /LEDGERD_URL/],
    ['a non-http ledgerd url', { ...valid, LEDGERD_URL: 'ftp://host' }, /LEDGERD_URL/],
    [
      'credentials in the ledgerd url',
      { ...valid, LEDGERD_URL: 'http://user:pw@host:8085' },
      /must not contain credentials/,
    ],
    ['no port', { ...valid, CONSOLE_ADDR: '127.0.0.1' }, /CONSOLE_ADDR/],
    ['port zero', { ...valid, CONSOLE_ADDR: '127.0.0.1:0' }, /port between 1 and 65535/],
    ['a huge port', { ...valid, CONSOLE_ADDR: '127.0.0.1:70000' }, /port between 1 and 65535/],
    [
      'a port with letters',
      { ...valid, CONSOLE_ADDR: '127.0.0.1:80a' },
      /port between 1 and 65535/,
    ],
    [
      'a host with a scheme',
      { ...valid, CONSOLE_ALLOWED_HOSTS: 'http://localhost:8787' },
      /CONSOLE_ALLOWED_HOSTS/,
    ],
    [
      'a host without a port',
      { ...valid, CONSOLE_ALLOWED_HOSTS: 'localhost' },
      /CONSOLE_ALLOWED_HOSTS/,
    ],
    [
      'an origin with a path',
      { ...valid, CONSOLE_ALLOWED_ORIGINS: 'http://localhost:8787/app' },
      /CONSOLE_ALLOWED_ORIGINS/,
    ],
    [
      'an origin without a scheme',
      { ...valid, CONSOLE_ALLOWED_ORIGINS: 'localhost:8787' },
      /CONSOLE_ALLOWED_ORIGINS/,
    ],
    ['a bad log level', { ...valid, CONSOLE_LOG_LEVEL: 'loud' }, /CONSOLE_LOG_LEVEL/],
  ])('rejects %s', (_name, env, message) => {
    expect(errors(env).join('\n')).toMatch(message);
  });

  it('reports every problem at once', () => {
    const all = errors({ LEDGERD_URL: 'nope', CONSOLE_ADDR: 'bad', CONSOLE_LOG_LEVEL: 'loud' });
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it('never puts the key, or a password in a URL, into an error message', () => {
    const secretKey = 'short-secret';
    const text = errors({
      LEDGERD_API_KEY: secretKey,
      LEDGERD_URL: 'http://admin:hunter2-password@host:8085',
    }).join('\n');
    expect(text).not.toContain(secretKey);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('admin');
  });
});

describe('isLoopback', () => {
  it.each(['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]'])('%s is loopback', (host) => {
    expect(isLoopback(host)).toBe(true);
  });
  it.each(['0.0.0.0', '192.168.1.5', '10.0.0.1', '::', 'example.com'])(
    '%s is not loopback',
    (host) => {
      expect(isLoopback(host)).toBe(false);
    },
  );
});
