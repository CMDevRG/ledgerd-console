import { z } from 'zod';

/**
 * An RFC 9457 problem document. ledgerd sends these for every refusal; the console server
 * adds `console_misconfigured` and `upstream_unavailable`, so `code` is any string here and
 * the UI branches on the codes it knows.
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().exactOptional(),
  instance: z.string().exactOptional(),
  request_id: z.string().exactOptional(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).exactOptional(),
});
export type Problem = z.infer<typeof problemSchema>;

/**
 * What kind of failure an API call was. The UI shows one component per kind:
 *
 * - `refused`: the server understood the request and said no (a problem document).
 * - `busy`: the service asked the caller to wait (503).
 * - `network`: no answer, or a gateway failure: the console server or ledgerd is unreachable.
 * - `unexpected`: an answer arrived, but it is not what the contract describes.
 */
export type ApiErrorKind = 'refused' | 'busy' | 'network' | 'unexpected';

export interface ApiErrorDetails {
  status?: number;
  problem?: Problem;
  requestId?: string;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly problem: Problem | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: ApiErrorKind, message: string, details: ApiErrorDetails = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = details.status;
    this.problem = details.problem;
    this.requestId = details.requestId ?? details.problem?.request_id;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }

  /** The error code of the problem document, when there is one. */
  get code(): string | undefined {
    return this.problem?.code;
  }

  /** Field errors from a validation_error, keyed by the field path the server reported. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.problem?.errors ?? []) out[e.field] ??= e.message;
    return out;
  }
}
