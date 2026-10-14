import type { z } from 'zod';

import { ApiError, problemSchema } from './problem';

/** Every call goes to the console server under this prefix; it forwards to ledgerd. */
const API_PREFIX = '/api';

/**
 * The console server refuses state-changing requests that do not carry this header.
 * Browsers cannot add a custom header to a cross-site request without a CORS preflight,
 * which the server never grants, so a hostile web page cannot make this call.
 */
export const CONSOLE_HEADER = 'X-Ledgerd-Console';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const RECONCILIATION_TIMEOUT_MS = 130_000;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST';
  /** Path as in the API documentation, for example `/v1/accounts`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Checks and converts the response body. */
  schema: z.ZodType<T>;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}

export interface ApiResult<T> {
  data: T;
  status: number;
  /** True when the server answered with the stored result of an earlier identical request. */
  replayed: boolean;
  /** The id the server gave this request, for support and logs. */
  requestId: string | undefined;
  /** The `Location` header, when the server sent one. */
  location: string | undefined;
}

/**
 * The only function in the application that calls `fetch`.
 *
 * It returns the parsed body or throws an {@link ApiError} of one of four kinds. A body
 * that does not match `schema` is an error (`unexpected`), never a value: the response is
 * parsed, not trusted.
 */
export async function request<T>(options: RequestOptions<T>): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = new URL(API_PREFIX + options.path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = new Headers({ Accept: 'application/json, application/problem+json' });
  if (method !== 'GET') headers.set(CONSOLE_HEADER, '1');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (cause) {
    // The caller cancelled (a query was superseded or a component unmounted): not an error to show.
    if (options.signal?.aborted === true) throw cause;
    if (timeout.aborted) {
      throw new ApiError(
        'network',
        `The request took longer than ${String(timeoutMs / 1000)} seconds and was cancelled.`,
      );
    }
    throw new ApiError('network', 'The console could not reach the server.');
  }

  const requestId = response.headers.get('X-Request-Id') ?? undefined;
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) throw failure(response, body, requestId);

  const parsed = options.schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      'unexpected',
      'The server answered with something this console does not understand.',
      {
        status: response.status,
        ...(requestId !== undefined ? { requestId } : {}),
      },
    );
  }
  return {
    data: parsed.data,
    status: response.status,
    replayed: response.headers.get('Idempotent-Replayed') === 'true',
    requestId,
    location: response.headers.get('Location') ?? undefined,
  };
}

function failure(response: Response, body: unknown, requestId: string | undefined): ApiError {
  const problem = problemSchema.safeParse(body);
  const base = {
    status: response.status,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(problem.success ? { problem: problem.data } : {}),
  };

  if (!problem.success) {
    return new ApiError(
      'unexpected',
      `The server answered HTTP ${String(response.status)} without an explanation.`,
      base,
    );
  }
  const { status, title } = problem.data;
  if (status === 503) {
    const retry = retryAfterSeconds(response.headers.get('Retry-After'));
    return new ApiError('busy', title, {
      ...base,
      ...(retry !== undefined ? { retryAfterSeconds: retry } : {}),
    });
  }
  if (status === 502 || status === 504) return new ApiError('network', title, base);
  return new ApiError('refused', title, base);
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null || !/^\d{1,5}$/.test(header)) return undefined;
  return Number.parseInt(header, 10);
}
