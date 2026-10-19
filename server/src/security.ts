import { getConnInfo } from '@hono/node-server/conninfo';
import { bodyLimit } from 'hono/body-limit';
import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv } from './app';
import { problemResponse } from './problem';
import type { RateLimiter } from './rate-limit';

/** The header every state-changing request from the console carries (see src/api/client.ts). */
export const CONSOLE_HEADER = 'X-Ledgerd-Console';

/**
 * Nothing in the application needs an inline script or style, an external host, or
 * a frame, so the policy allows none of them. Vite emits external files and Tailwind compiles to a
 * stylesheet; a test fails if the built index.html contains an inline script or style.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

type Middleware = MiddlewareHandler<AppEnv>;

/** Headers added to every response, including the ones that refuse a request. */
export function securityHeaders(): Middleware {
  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (new URL(c.req.url).pathname.startsWith('/api/')) headers.set('Cache-Control', 'no-store');
  };
}

/**
 * Refuses requests addressed to a host name the server was not configured to serve.
 *
 * This stops DNS rebinding: a hostile web page makes its own domain resolve to 127.0.0.1,
 * and the browser then sends our server requests that look same-origin to it. Such a
 * request carries the hostile name in `Host`, which is not on the list.
 */
export function hostCheck(allowedHosts: readonly string[]): Middleware {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return async (c, next) => {
    const host = c.req.header('Host')?.toLowerCase();
    if (host === undefined || !allowed.has(host)) {
      return problemResponse(
        c,
        421,
        'misdirected_request',
        'Misdirected request',
        'This host name is not served here.',
      );
    }
    await next();
    return undefined;
  };
}

/** Limits how fast one client may call the server, answering 429 with the time to wait. */
export function rateLimit(limiter: RateLimiter): Middleware {
  return async (c, next) => {
    let client = 'unknown';
    try {
      client = getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      // Not running on a real socket (in-process tests): all requests share one bucket.
    }
    const wait = limiter.take(client);
    if (wait > 0) {
      return problemResponse(
        c,
        429,
        'too_many_requests',
        'Too many requests',
        'Slow down and try again shortly.',
        {
          'Retry-After': String(Math.max(1, Math.ceil(wait))),
        },
      );
    }
    await next();
    return undefined;
  };
}

/**
 * Cross-site request forgery defence for everything that changes state.
 *
 * A web page the user happens to have open can make the browser send a POST to this
 * server. It cannot make that POST carry a custom header without a CORS preflight, and
 * this server never answers a preflight with permission. So a POST without the console's
 * header did not come from the console. `Origin` and `Sec-Fetch-Site` (sent by browsers,
 * not forgeable by web pages) are checked as a second, independent line.
 */
export function crossSiteDefence(allowedOrigins: readonly string[]): Middleware {
  const origins = new Set(allowedOrigins);
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();

    const refuse = (): Response =>
      problemResponse(
        c,
        403,
        'forbidden',
        'Forbidden',
        'This request was not made by the console.',
      );

    if (c.req.header(CONSOLE_HEADER) !== '1') return refuse();
    const origin = c.req.header('Origin');
    if (origin !== undefined && !origins.has(origin)) return refuse();
    const site = c.req.header('Sec-Fetch-Site');
    if (site !== undefined && site !== 'same-origin') return refuse();
    return next();
  };
}

/**
 * Whether the request carries a body. `Request.body` cannot say: when a request arrives over a
 * socket, the server library gives every POST a body stream, empty or not. The headers do:
 * a length above zero, or chunked transfer. (A browser's `fetch` of a POST with no body sends
 * `Content-Length: 0`; a call that has nothing to say, such as a reversal, is not a JSON body.)
 */
export function hasBody(request: Request): boolean {
  const length = request.headers.get('Content-Length');
  if (length !== null) return !/^\s*0+\s*$/.test(length);
  return request.headers.has('Transfer-Encoding');
}

/** Limits the size of a request body and requires JSON when there is one. */
export function jsonBodyLimit(maxBytes: number): Middleware {
  const limit = bodyLimit({
    maxSize: maxBytes,
    // The library hands us a Context without our typed variables; it is the same object.
    onError: (c: Context) =>
      problemResponse(
        c as Context<AppEnv>,
        413,
        'payload_too_large',
        'Request body too large',
        'The request body exceeds the allowed size.',
      ),
  });
  return async (c, next) => {
    if (hasBody(c.req.raw)) {
      const type = c.req.header('Content-Type')?.toLowerCase().split(';')[0]?.trim();
      if (type !== 'application/json') {
        return problemResponse(
          c,
          415,
          'unsupported_media_type',
          'Unsupported media type',
          'Send the body as application/json.',
        );
      }
    }
    return limit(c, next);
  };
}
