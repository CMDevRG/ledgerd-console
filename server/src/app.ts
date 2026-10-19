import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';

import type { Config } from './config';
import { forward } from './forward';
import { staticFiles } from './static';
import { RateLimiter } from './rate-limit';
import { crossSiteDefence, hostCheck, jsonBodyLimit, rateLimit, securityHeaders } from './security';
import type { Logger } from './logger';
import { problemResponse } from './problem';

export interface AppEnv {
  Variables: { requestId: string; forwarded?: boolean };
}

export interface AppDeps {
  config: Config;
  logger: Logger;
  /** Can the console server reach ledgerd and is it ready? Never throws. */
  checkLedgerd: () => Promise<boolean>;
  /** Overrides for the request limits; the defaults are what the console ships with. */
  limits?: Partial<Limits>;
  /** Time source for the rate limiter (tests inject a fake clock). */
  now?: () => number;
  /** Replaces the per-route timeouts for forwarded calls (tests). */
  forwardTimeoutMs?: number;
}

export interface Limits {
  /** Sustained requests per second per client. */
  ratePerSecond: number;
  /** Requests a client may make at once. */
  burst: number;
  /** Largest accepted request body. */
  maxBodyBytes: number;
}

export const DEFAULT_LIMITS: Limits = { ratePerSecond: 50, burst: 200, maxBodyBytes: 64 * 1024 };

/** Only a conservative alphabet is taken from clients, so an id is safe in logs and headers. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { logger } = deps;
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const limiter = new RateLimiter({
    ratePerSecond: limits.ratePerSecond,
    burst: limits.burst,
    ...(deps.now ? { now: deps.now } : {}),
  });
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
    const path = new URL(c.req.url).pathname;
    // The container's health check calls /healthz every few seconds. A line for each would bury
    // the real ones, so a healthy probe is logged at debug level; a failed one is not hidden.
    const quiet = path === '/healthz' && c.res.status === 200;
    logger[quiet ? 'debug' : 'info']('request', {
      request_id: c.get('requestId'),
      method: c.req.method,
      path,
      status: c.res.status,
      forwarded: c.get('forwarded') === true,
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
    });
  });

  // 3. Security, in this order. Headers wrap everything, so refusals carry them too.
  app.use('*', securityHeaders());
  app.use('*', hostCheck(deps.config.allowedHosts));
  app.use('*', rateLimit(limiter));
  // Everything under /api can change money, so it gets the cross-site and size defences.
  app.use('/api/*', crossSiteDefence(deps.config.allowedOrigins));
  app.use('/api/*', jsonBodyLimit(limits.maxBodyBytes));

  // The API: forwarded to ledgerd if, and only if, it is on the allow-list.
  app.all(
    '/api/*',
    forward({
      config: deps.config,
      logger,
      ...(deps.forwardTimeoutMs !== undefined ? { timeoutMs: deps.forwardTimeoutMs } : {}),
    }),
  );

  // The console server's own probes. They are not forwarded to ledgerd.
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/readyz', async (c) => {
    const ready = await deps.checkLedgerd().catch(() => false);
    if (ready) return c.json({ status: 'ready' });
    return problemResponse(c, 503, 'not_ready', 'Service not ready', 'ledgerd cannot be reached.', {
      'Retry-After': '1',
    });
  });

  // What no route claimed: the web application (files from dist/, and index.html for page
  // routes) for reads, a plain 404 for anything else.
  const application = staticFiles(deps.config.staticDir);
  app.notFound((c) =>
    c.req.method === 'GET' || c.req.method === 'HEAD'
      ? application(c)
      : problemResponse(c, 404, 'not_found', 'Not found'),
  );

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
