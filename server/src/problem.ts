import type { Context } from 'hono';

import type { AppEnv } from './app';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** The error codes the console server itself can produce (ledgerd's own pass through unchanged). */
export type ServerErrorCode =
  | 'not_found'
  | 'method_not_allowed'
  | 'misdirected_request'
  | 'forbidden'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'too_many_requests'
  | 'console_misconfigured'
  | 'upstream_unavailable'
  | 'not_ready'
  | 'internal_error';

/**
 * Answers with an RFC 9457 problem document, the same shape ledgerd uses, so the browser
 * handles errors from both in one way. `detail` must be safe to show: never a stack trace,
 * a path, or anything about the configuration.
 */
export function problemResponse(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: ServerErrorCode,
  title: string,
  detail?: string,
  headers: Record<string, string> = {},
): Response {
  const body = {
    type: `urn:ledgerd-console:error:${code}`,
    title,
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
    instance: new URL(c.req.url).pathname,
    request_id: c.res.headers.get('X-Request-Id') ?? c.get('requestId'),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/problem+json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
