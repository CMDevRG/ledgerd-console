import { loadConfig } from '../src/config';

type Env = Readonly<Record<string, string | undefined>>;

/** Where Vite serves the web application during development. */
export const WEB_PORT = 5173;

export type DevEnvironment =
  | {
      ok: true;
      /** Environment for the console server. */
      server: Record<string, string>;
      /** Environment for Vite. */
      web: Record<string, string>;
    }
  | { ok: false; errors: string[] };

const definedOnly = (env: Env): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));

/**
 * Works out how to run the two development processes from the environment (and
 * `.env.local`, loaded by Node before this runs).
 *
 * In development the browser talks to Vite on port 5173, which forwards `/api` to the console
 * server on 8787. The server sees the browser's `Host` and `Origin`, so it must accept the
 * Vite ones in addition to its own; they are added here, and only here, so the production
 * defaults stay strict.
 */
export function devEnvironment(env: Env): DevEnvironment {
  const webHosts = [`localhost:${String(WEB_PORT)}`, `127.0.0.1:${String(WEB_PORT)}`];
  const webOrigins = webHosts.map((host) => `http://${host}`);

  const server: Record<string, string | undefined> = {
    ...definedOnly(env),
    CONSOLE_LOG_LEVEL: env.CONSOLE_LOG_LEVEL ?? 'debug',
  };

  // The server's own defaults (its port, on localhost and 127.0.0.1), plus Vite's.
  const own = loadConfig({ ...server, LEDGERD_API_KEY: server.LEDGERD_API_KEY ?? 'x'.repeat(16) });
  if (own.ok) {
    server.CONSOLE_ALLOWED_HOSTS ??= [...own.config.allowedHosts, ...webHosts].join(',');
    server.CONSOLE_ALLOWED_ORIGINS ??= [...own.config.allowedOrigins, ...webOrigins].join(',');
  }

  const loaded = loadConfig(server);
  if (!loaded.ok) {
    const errors = loaded.errors.map((e) =>
      e.startsWith('LEDGERD_API_KEY is required')
        ? 'LEDGERD_API_KEY is required: put it in .env.local (see .env.example); it is the key of your ledgerd stack'
        : e,
    );
    return { ok: false, errors };
  }

  const { host, port } = loaded.config;
  return {
    ok: true,
    server: definedOnly(server),
    web: { ...definedOnly(env), CONSOLE_SERVER_URL: `http://${host}:${String(port)}` },
  };
}
