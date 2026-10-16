/*
 * The Failure Lab runs scenarios against ledgerd and records every request and answer so a
 * person can read exactly what happened. A scenario is a plain async function over a LabApi,
 * so it can be tested against a fake ledger and run against the real one (requirement R9.7).
 */

export type ScenarioId =
  | 'overdraft'
  | 'retry'
  | 'key-reuse'
  | 'unbalanced'
  | 'number-amount'
  | 'precision'
  | 'double-reversal'
  | 'concurrency';

export interface LabRequest {
  method: 'GET' | 'POST';
  /** As in the API documentation, for example `/v1/transactions`. */
  path: string;
  /** Only `Idempotency-Key` is ever set by a scenario. */
  idempotencyKey?: string;
  /** Sent as JSON. A scenario may put a JSON number where a string belongs, on purpose. */
  body?: unknown;
}

/** One HTTP round trip, as it happened. It never contains the API key: the browser has none. */
export interface Exchange {
  method: string;
  path: string;
  /** The request headers worth showing. */
  requestHeaders: Record<string, string>;
  body?: unknown;
  status: number;
  /** The response headers worth showing, in lower case. */
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  ms: number;
}

/** Sends a request and records it. It does not throw on an HTTP error, only when there is no answer. */
export interface LabApi {
  send(request: LabRequest): Promise<Exchange>;
}

/** Names and keys for a run, injectable so tests are deterministic. */
export interface IdSource {
  /** Short and unique per run, so lab accounts of different runs never collide. */
  runId(): string;
  /** A fresh Idempotency-Key. */
  key(): string;
}

export interface Check {
  label: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface Step {
  title: string;
  /** Plain language: what was done and why the outcome is the right one. */
  explanation: string;
  exchanges: Exchange[];
  checks: Check[];
}

export type Verdict = 'as-designed' | 'unexpected' | 'could-not-run';

export interface ScenarioResult {
  id: ScenarioId;
  verdict: Verdict;
  steps: Step[];
  /** Why it could not run, when the verdict says so. */
  error?: string;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** One or two sentences: what it tries and what must happen. */
  summary: string;
  run(api: LabApi, ids: IdSource): Promise<ScenarioResult>;
}
