import { Secret } from './secret';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  /** Base URL of ledgerd. */
  ledgerdUrl: URL;
  /** Added to forwarded requests; never logged and never sent to the browser. */
  apiKey: Secret;
  host: string;
  port: number;
  /** `Host` header values the server accepts (stops DNS rebinding). */
  allowedHosts: string[];
  /** `Origin` values accepted on state-changing requests. */
  allowedOrigins: string[];
  logLevel: LogLevel;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: string[] };

type Env = Readonly<Record<string, string | undefined>>;

export const MIN_API_KEY_LENGTH = 16;
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Reads the configuration from environment variables and reports every problem at once.
 * No message ever contains the API key.
 */
export function loadConfig(env: Env): ConfigResult {
  const errors: string[] = [];

  const ledgerdUrl = parseLedgerdUrl(env.LEDGERD_URL ?? 'http://127.0.0.1:8085', errors);

  const key = env.LEDGERD_API_KEY ?? '';
  if (key === '') errors.push('LEDGERD_API_KEY is required');
  else if (key.length < MIN_API_KEY_LENGTH) {
    errors.push(`LEDGERD_API_KEY must be at least ${String(MIN_API_KEY_LENGTH)} characters`);
  }

  const { host, port } = parseAddress(env.CONSOLE_ADDR ?? '127.0.0.1:8787', errors);

  const allowedHosts = parseList(
    env.CONSOLE_ALLOWED_HOSTS,
    [`localhost:${String(port)}`, `127.0.0.1:${String(port)}`],
    'CONSOLE_ALLOWED_HOSTS',
    validHost,
    'must be host:port entries without a scheme or path',
    errors,
  );
  const allowedOrigins = parseList(
    env.CONSOLE_ALLOWED_ORIGINS,
    [`http://localhost:${String(port)}`, `http://127.0.0.1:${String(port)}`],
    'CONSOLE_ALLOWED_ORIGINS',
    validOrigin,
    'must be origins such as http://localhost:8787 (no path)',
    errors,
  );

  const level = (env.CONSOLE_LOG_LEVEL ?? 'info').toLowerCase();
  if (!LEVELS.includes(level as LogLevel)) {
    errors.push(`CONSOLE_LOG_LEVEL must be one of ${LEVELS.join(', ')}`);
  }

  if (errors.length > 0 || ledgerdUrl === undefined) return { ok: false, errors };
  return {
    ok: true,
    config: {
      ledgerdUrl,
      apiKey: new Secret(key),
      host,
      port,
      allowedHosts,
      allowedOrigins,
      logLevel: level as LogLevel,
    },
  };
}

function parseLedgerdUrl(raw: string, errors: string[]): URL | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    if (url.username !== '' || url.password !== '') {
      errors.push('LEDGERD_URL must not contain credentials');
      return undefined;
    }
    return url;
  } catch {
    errors.push('LEDGERD_URL must be an http:// or https:// URL');
    return undefined;
  }
}

function parseAddress(raw: string, errors: string[]): { host: string; port: number } {
  const fallback = { host: '127.0.0.1', port: 8787 };
  const index = raw.lastIndexOf(':');
  if (index <= 0) {
    errors.push('CONSOLE_ADDR must be host:port, for example 127.0.0.1:8787');
    return fallback;
  }
  const host = raw.slice(0, index);
  const portText = raw.slice(index + 1);
  const port = /^\d{1,5}$/.test(portText) ? Number.parseInt(portText, 10) : 0;
  if (port < 1 || port > 65535) {
    errors.push('CONSOLE_ADDR must have a port between 1 and 65535');
    return fallback;
  }
  return { host, port };
}

function parseList(
  raw: string | undefined,
  fallback: string[],
  name: string,
  isValid: (entry: string) => boolean,
  rule: string,
  errors: string[],
): string[] {
  if (raw === undefined || raw.trim() === '') return fallback;
  const entries = raw.split(',').map((e) => e.trim());
  if (entries.some((e) => !isValid(e))) {
    errors.push(`${name} ${rule}`);
    return fallback;
  }
  return entries;
}

const validHost = (entry: string): boolean => /^[A-Za-z0-9.[\]:-]+:\d{1,5}$/.test(entry);

function validOrigin(entry: string): boolean {
  try {
    const url = new URL(entry);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === entry;
  } catch {
    return false;
  }
}

/** True when the address is only reachable from this machine. */
export function isLoopback(host: string): boolean {
  return (
    host === 'localhost' || host === '::1' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}
