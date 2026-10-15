import type { Context } from 'hono';

import type { AppEnv } from './app';
import type { Config } from './config';
import type { Logger } from './logger';
import { problemResponse } from './problem';
import { matchRoute } from './routes';

/** The only response headers relayed to the browser; everything else ledgerd sends is dropped. */
const RESPONSE_HEADERS_TO_RELAY = [
  'Content-Type',
  'Idempotent-Replayed',
  'Retry-After',
  'Allow',
] as const;

const API_PREFIX = '/api';

export interface ForwardOptions {
  config: Config;
  logger: Logger;
  /** Replaces the per-route timeouts (tests). */
  timeoutMs?: number;
}

/**
 * Forwards an allow-listed API call to ledgerd, adding the API key.
 *
 * What crosses in each direction is fixed. To ledgerd: the method and path (rewritten
 * without the /api prefix), the query string, the JSON body, `Content-Type`,
 * `Idempotency-Key`, our request id, and `Authorization: Bearer <key>` added here. To the
 * browser: status, body and `Content-Type`, `Idempotent-Replayed`, `Retry-After`, `Allow`,
 * and `Location` with the /api prefix put back. Everything else is dropped, notably any
 * cookie or header that could carry the key.
 */
export function forward(options: ForwardOptions) {
  const { config, logger } = options;
  const base = config.ledgerdUrl.pathname.replace(/\/$/, '');

  return async (c: Context<AppEnv>): Promise<Response> => {
    const url = new URL(c.req.url);
    const path = url.pathname.slice(API_PREFIX.length);

    const match = matchRoute(c.req.method, path);
    if (match.kind === 'unknown') return problemResponse(c, 404, 'not_found', 'Not found');
    if (match.kind === 'method-not-allowed') {
      return problemResponse(c, 405, 'method_not_allowed', 'Method not allowed', undefined, {
        Allow: match.allow.join(', '),
      });
    }

    const upstream = new URL(`${base}${path}${url.search}`, config.ledgerdUrl);
    const headers = new Headers({
      Accept: 'application/json, application/problem+json',
      Authorization: `Bearer ${config.apiKey.reveal()}`,
      'X-Request-Id': c.get('requestId'),
    });
    const contentType = c.req.header('Content-Type');
    if (contentType !== undefined && c.req.raw.body !== null)
      headers.set('Content-Type', contentType);
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey);

    c.set('forwarded', true);
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(upstream, {
        method: c.req.method,
        headers,
        ...(c.req.raw.body !== null ? { body: await c.req.arrayBuffer() } : {}),
        redirect: 'manual', // never follow a redirect with the key attached
        signal: AbortSignal.timeout(options.timeoutMs ?? match.route.timeoutMs),
      });
    } catch (error) {
      logger.warn('ledgerd could not be reached', {
        request_id: c.get('requestId'),
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return problemResponse(
        c,
        504,
        'upstream_unavailable',
        'The ledger is unreachable',
        'The console could not get an answer from ledgerd.',
      );
    }
    logger.debug('forwarded', {
      request_id: c.get('requestId'),
      upstream_status: response.status,
      upstream_ms: Math.round(performance.now() - started),
    });

    // The key is the console server's, not the browser's: a refusal of it is a server
    // problem the browser cannot fix, so it is never passed on.
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      logger.error('ledgerd refused the console server API key; check LEDGERD_API_KEY', {
        request_id: c.get('requestId'),
        upstream_status: response.status,
      });
      return problemResponse(
        c,
        502,
        'console_misconfigured',
        'The console is misconfigured',
        'The console server is not authorised to use the ledger. See its log.',
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return problemResponse(
        c,
        502,
        'upstream_unavailable',
        'Unexpected answer from the ledger',
        'The ledger answered with a redirect.',
      );
    }

    const relayed = new Headers();
    for (const name of RESPONSE_HEADERS_TO_RELAY) {
      const value = response.headers.get(name);
      if (value !== null) relayed.set(name, value);
    }
    const location = response.headers.get('Location');
    const rewritten = location === null ? undefined : rewriteLocation(location, config.ledgerdUrl);
    if (rewritten !== undefined) relayed.set('Location', rewritten);

    return new Response(response.body, { status: response.status, headers: relayed });
  };
}

/**
 * ledgerd sends a path such as /v1/transactions/<id>; for the browser it lives under /api.
 * An absolute URL is accepted only if it points at ledgerd itself. Anything else is dropped,
 * so ledgerd can never send the browser somewhere else.
 */
export function rewriteLocation(location: string, ledgerd: URL): string | undefined {
  try {
    const url = new URL(location, ledgerd);
    if (url.origin !== ledgerd.origin) return undefined;
    const base = ledgerd.pathname.replace(/\/$/, '');
    // ledgerd only ever points at its own API; anything else is not worth relaying.
    if (location === '' || !url.pathname.startsWith(`${base}/v1/`)) return undefined;
    return `${API_PREFIX}${url.pathname.slice(base.length)}${url.search}`;
  } catch {
    return undefined;
  }
}
