import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';

import type { Config } from './config';
import type { Logger } from './logger';
import { problemResponse } from './problem';

export interface AppEnv {
  Variables: { requestId: string };
}

export interface AppDeps {
  config: Config;
  logger: Logger;
  /** Can the console server reach ledgerd and is it ready? Never throws. */
  checkLedgerd: () => Promise<boolean>;
}

/** Only a conservative alphabet is taken from clients, so an id is safe in logs and headers. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { logger } = deps;
  const app = new Hono<AppEnv>();

  // 1. Every request gets an id, returned to the client and put in every log line.
  app.use('*', async (c, next) => {
    const offered = c.req.header('X-Request-Id');
    const id =
      offered !== undefined && VALID_REQUEST_ID.test(offered)
        ? offered
        : randomBytes(16).toString('hex');
    c.set('requestId', id);
    await next();
    c.res.headers.set('X-Request-Id', id);
  });

  // 2. One access-log line per request: never headers, query strings or bodies.
  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    logger.info('request', {
      request_id: c.get('requestId'),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
    });
  });

  // The console server's own probes. They are not forwarded to ledgerd.
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/readyz', async (c) => {
    const ready = await deps.checkLedgerd().catch(() => false);
    if (ready) return c.json({ status: 'ready' });
    return problemResponse(c, 503, 'not_ready', 'Service not ready', 'ledgerd cannot be reached.', {
      'Retry-After': '1',
    });
  });

  app.notFound((c) => problemResponse(c, 404, 'not_found', 'Not found'));

  // Anything unexpected becomes a generic 500. The cause goes to the log, never to the client.
  app.onError((error, c) => {
    logger.error('unhandled error', {
      request_id: c.get('requestId'),
      error: error instanceof Error ? error.message : 'non-error thrown',
    });
    return problemResponse(
      c,
      500,
      'internal_error',
      'Internal error',
      'An unexpected error occurred.',
    );
  });

  return app;
}
