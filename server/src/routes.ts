/**
 * The only calls the console server will forward to ledgerd. Anything else is answered
 * here with 404 or 405, without contacting ledgerd. The paths are ledgerd's, written as in
 * its OpenAPI document; the browser calls them with an `/api` prefix.
 *
 * A test compares this table with the operations of the generated API types, so adding an
 * endpoint to ledgerd never exposes it through the console by accident, and removing one
 * is noticed.
 */
export type Method = 'GET' | 'POST';

export interface AllowedRoute {
  method: Method;
  /** ledgerd's path; `{id}` stands for one identifier segment. */
  path: string;
  /** How long the call may take before it is cancelled. */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** A reconciliation scans the whole ledger, so it gets longer. */
export const RECONCILIATION_TIMEOUT_MS = 120_000;

export const ROUTES: readonly AllowedRoute[] = [
  { method: 'GET', path: '/readyz', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'GET', path: '/v1/accounts', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'POST', path: '/v1/accounts', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'GET', path: '/v1/accounts/{id}', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'GET', path: '/v1/accounts/{id}/balance', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'GET', path: '/v1/accounts/{id}/postings', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'POST', path: '/v1/transactions', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'GET', path: '/v1/transactions/{id}', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'POST', path: '/v1/transactions/{id}/reverse', timeoutMs: DEFAULT_TIMEOUT_MS },
  { method: 'POST', path: '/v1/reconciliations', timeoutMs: RECONCILIATION_TIMEOUT_MS },
];

/**
 * ledgerd operations the console deliberately does not expose, with the reason. The
 * comparison test requires every operation to be in ROUTES or here.
 */
export const NOT_EXPOSED: readonly { method: Method; path: string; reason: string }[] = [
  {
    method: 'GET',
    path: '/healthz',
    reason: 'liveness of ledgerd is the concern of its own orchestrator, not of the browser',
  },
];

/** An identifier segment: letters, digits and dashes only (ledgerd checks that it is a UUID). */
const SEGMENT = '(?<id>[A-Za-z0-9-]{1,64})';

const compiled = ROUTES.map((route) => ({
  route,
  pattern: new RegExp(`^${route.path.replaceAll('{id}', SEGMENT)}$`),
}));

export type Match =
  | { kind: 'route'; route: AllowedRoute }
  | { kind: 'method-not-allowed'; allow: Method[] }
  | { kind: 'unknown' };

/** Looks a browser-side path (without the /api prefix) up in the allow-list. */
export function matchRoute(method: string, path: string): Match {
  const allow: Method[] = [];
  for (const { route, pattern } of compiled) {
    if (!pattern.test(path)) continue;
    if (route.method === method) return { kind: 'route', route };
    allow.push(route.method);
  }
  return allow.length > 0 ? { kind: 'method-not-allowed', allow } : { kind: 'unknown' };
}
