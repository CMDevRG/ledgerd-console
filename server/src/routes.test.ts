import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { matchRoute, NOT_EXPOSED, RECONCILIATION_TIMEOUT_MS, ROUTES } from './routes';

/**
 * The operations of ledgerd's API, read from the types generated from its OpenAPI file
 * (src/api/schema.d.ts, the `paths` interface). Lines look like:
 *
 *     "/v1/accounts/{id}": {
 *         get: operations["getAccount"];
 *         put?: never;
 */
function generatedOperations(): Set<string> {
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'api',
    'schema.d.ts',
  );
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('export interface paths {'));
  const operations = new Set<string>();
  let path = '';
  for (const line of lines.slice(start + 1)) {
    if (line === '}') break;
    const pathMatch = /^ {4}"(\/[^"]*)": \{$/.exec(line);
    if (pathMatch?.[1] !== undefined) path = pathMatch[1];
    const methodMatch = /^ {8}(get|put|post|delete|options|head|patch|trace): operations\[/.exec(
      line,
    );
    if (methodMatch?.[1] !== undefined) operations.add(`${methodMatch[1].toUpperCase()} ${path}`);
  }
  return operations;
}

describe('the allow-list and ledgerd contract', () => {
  const generated = generatedOperations();

  it('reads the operations out of the generated types', () => {
    expect(generated.size).toBeGreaterThanOrEqual(10);
    expect(generated).toContain('POST /v1/transactions');
    expect(generated).toContain('GET /v1/accounts');
  });

  it('every forwarded route exists in the contract', () => {
    for (const route of ROUTES) {
      expect(generated, `${route.method} ${route.path} is not an operation of ledgerd`).toContain(
        `${route.method} ${route.path}`,
      );
    }
  });

  it('every ledgerd operation is either forwarded or deliberately not exposed', () => {
    const known = new Set([
      ...ROUTES.map((r) => `${r.method} ${r.path}`),
      ...NOT_EXPOSED.map((r) => `${r.method} ${r.path}`),
    ]);
    const forgotten = [...generated].filter((operation) => !known.has(operation));
    expect(
      forgotten,
      'new ledgerd operations must be added to ROUTES or NOT_EXPOSED on purpose',
    ).toEqual([]);
  });

  it('has no duplicates, and every deliberate omission has a reason', () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const omitted of NOT_EXPOSED) expect(omitted.reason.length).toBeGreaterThan(10);
  });

  it('only reads and the four writes the console needs are allowed: no update, no delete', () => {
    expect([...new Set<string>(ROUTES.map((r) => r.method))].sort()).toEqual(['GET', 'POST']);
    expect(ROUTES.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual([
      '/v1/accounts',
      '/v1/transactions',
      '/v1/transactions/{id}/reverse',
      '/v1/reconciliations',
    ]);
  });

  it('gives reconciliation more time than anything else', () => {
    const longest = Math.max(...ROUTES.map((r) => r.timeoutMs));
    expect(ROUTES.find((r) => r.path === '/v1/reconciliations')?.timeoutMs).toBe(
      RECONCILIATION_TIMEOUT_MS,
    );
    expect(RECONCILIATION_TIMEOUT_MS).toBe(longest);
    expect(
      ROUTES.filter((r) => r.path !== '/v1/reconciliations').every(
        (r) => r.timeoutMs < RECONCILIATION_TIMEOUT_MS,
      ),
    ).toBe(true);
  });
});

const ID = '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11';

describe('matchRoute', () => {
  it.each([
    ['GET', '/readyz'],
    ['GET', '/v1/accounts'],
    ['POST', '/v1/accounts'],
    ['GET', `/v1/accounts/${ID}`],
    ['GET', `/v1/accounts/${ID}/balance`],
    ['GET', `/v1/accounts/${ID}/postings`],
    ['POST', '/v1/transactions'],
    ['GET', `/v1/transactions/${ID}`],
    ['POST', `/v1/transactions/${ID}/reverse`],
    ['POST', '/v1/reconciliations'],
  ])('allows %s %s', (method, path) => {
    expect(matchRoute(method, path).kind).toBe('route');
  });

  it('answers method-not-allowed, with the methods that would work', () => {
    expect(matchRoute('DELETE', '/v1/accounts')).toEqual({
      kind: 'method-not-allowed',
      allow: ['GET', 'POST'],
    });
    expect(matchRoute('POST', `/v1/accounts/${ID}`)).toEqual({
      kind: 'method-not-allowed',
      allow: ['GET'],
    });
    expect(matchRoute('GET', '/v1/reconciliations')).toEqual({
      kind: 'method-not-allowed',
      allow: ['POST'],
    });
  });

  it.each(['HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'CONNECT'])(
    'never allows %s anywhere',
    (method) => {
      for (const route of ROUTES) {
        expect(matchRoute(method, route.path.replace('{id}', ID)).kind).not.toBe('route');
      }
    },
  );

  it.each([
    '/healthz',
    '/v1',
    '/v1/',
    '/v1/accounts/',
    '/v1/accounts/x/y/z',
    `/v1/accounts/${ID}/postings/extra`,
    `/v1/accounts/${ID}/other`,
    '/v1/admin',
    '/V1/accounts',
    '/v1/Accounts',
    '//v1/accounts',
    '/readyz/',
    '',
    '/',
  ])('does not know %j', (path) => {
    expect(matchRoute('GET', path)).toEqual({ kind: 'unknown' });
  });

  it.each([
    '/v1/accounts/..',
    '/v1/accounts/../transactions',
    `/v1/accounts/${ID}/../..`,
    '/v1/accounts/%2e%2e',
    '/v1/accounts/%2F',
    '/v1/accounts/a%2Fb',
    '/v1/accounts/a b',
    '/v1/accounts/a;b',
    '/v1/accounts/a?x=1',
    `/v1/accounts/${'a'.repeat(65)}`,
    '/v1/accounts/\u0000',
  ])('refuses path tricks: %j', (path) => {
    expect(matchRoute('GET', path)).toEqual({ kind: 'unknown' });
  });

  it('lets a malformed (but harmless) identifier through, so ledgerd can explain what is wrong', () => {
    expect(matchRoute('GET', '/v1/accounts/42').kind).toBe('route');
    expect(matchRoute('GET', '/v1/accounts/NOT-A-UUID').kind).toBe('route');
    // "reverse" here is just an identifier; ledgerd answers 400, and no write is reachable this way.
    expect(matchRoute('GET', '/v1/transactions/reverse').kind).toBe('route');
    expect(matchRoute('POST', '/v1/transactions/reverse').kind).toBe('method-not-allowed');
  });
});
