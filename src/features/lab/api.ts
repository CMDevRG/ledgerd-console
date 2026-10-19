import { rawRequest } from '../../api/client';
import { newIdempotencyKey } from '../transactions/key';
import { observedInFlight, timingEntries } from './concurrency';
import type { Exchange, IdSource, LabApi, LabRequest } from './types';

/**
 * Response headers shown in an exchange. A list of names to keep, not names to drop: anything
 * not listed here is never recorded.
 */
export const SHOWN_RESPONSE_HEADERS = [
  'content-type',
  'idempotent-replayed',
  'location',
  'retry-after',
  'x-request-id',
] as const;

/** Request headers shown. The API key is added by the console server and is not here. */
export const SHOWN_REQUEST_HEADERS = ['content-type', 'idempotency-key'] as const;

/** The part of `performance` used to measure concurrency (replaceable in tests). */
export interface TimingSource {
  now(): number;
  getEntriesByType?(type: string): readonly unknown[];
}

/** Resource Timing entries are queued a moment after a request ends; wait for them. */
const TIMING_SETTLE_MS = 50;

/** The Lab's API: real requests through the console server, recorded. */
export function createLabApi(timing: TimingSource = performance): LabApi {
  return {
    async observeConcurrency<T>(work: () => Promise<T>) {
      const since = timing.now();
      const value = await work();
      await new Promise((resolve) => setTimeout(resolve, TIMING_SETTLE_MS));
      const entries = timing.getEntriesByType?.('resource') ?? [];
      return { value, peak: observedInFlight(timingEntries(entries), since) };
    },

    async send(request: LabRequest): Promise<Exchange> {
      const sent: Record<string, string> = {};
      if (request.body !== undefined) sent['content-type'] = 'application/json';
      if (request.idempotencyKey !== undefined) sent['idempotency-key'] = request.idempotencyKey;

      const response = await rawRequest({
        method: request.method,
        path: request.path,
        ...(request.idempotencyKey !== undefined
          ? { headers: { 'Idempotency-Key': request.idempotencyKey } }
          : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
      });

      const responseHeaders: Record<string, string> = {};
      for (const name of SHOWN_RESPONSE_HEADERS) {
        const value = response.headers[name];
        if (value !== undefined) responseHeaders[name] = value;
      }
      return {
        method: request.method,
        path: request.path,
        requestHeaders: sent,
        ...(request.body !== undefined ? { body: request.body } : {}),
        status: response.status,
        responseHeaders,
        responseBody: response.body,
        ms: response.ms,
      };
    },
  };
}

/** Ids for a real run: a short random run id and a UUID for each key. */
export function createIdSource(): IdSource {
  return {
    runId: () => newIdempotencyKey().replaceAll('-', '').slice(0, 8),
    key: () => newIdempotencyKey(),
  };
}
