import { http, HttpResponse } from 'msw';

import { server } from './server';

const PROBLEM = { 'Content-Type': 'application/problem+json' };

/** Answers for /readyz, as ledgerd and the console server give them. */
export const readyz = {
  ready: () => http.get('*/api/readyz', () => HttpResponse.json({ status: 'ready' })),
  notReady: (detail = 'the database cannot be reached') =>
    http.get('*/api/readyz', () =>
      HttpResponse.json(
        {
          type: 'urn:ledgerd:error:not_ready',
          title: 'Service not ready',
          status: 503,
          code: 'not_ready',
          detail,
          request_id: 'req-not-ready-0001',
        },
        { status: 503, headers: { ...PROBLEM, 'Retry-After': '1' } },
      ),
    ),
  misconfigured: () =>
    http.get('*/api/readyz', () =>
      HttpResponse.json(
        {
          type: 'urn:ledgerd-console:error:console_misconfigured',
          title: 'The console is misconfigured',
          status: 502,
          code: 'console_misconfigured',
        },
        { status: 502, headers: PROBLEM },
      ),
    ),
  unreachable: () => http.get('*/api/readyz', () => HttpResponse.error()),
  gatewayDown: () =>
    http.get('*/api/readyz', () =>
      HttpResponse.json(
        {
          type: 'urn:ledgerd-console:error:upstream_unavailable',
          title: 'The ledger is unreachable',
          status: 504,
          code: 'upstream_unavailable',
        },
        { status: 504, headers: PROBLEM },
      ),
    ),
  unexpectedBody: () =>
    http.get('*/api/readyz', () => HttpResponse.json({ status: 'fine, thanks' })),
  neverAnswers: () => http.get('*/api/readyz', () => new Promise(() => undefined)),
};

/** Makes /readyz answer in one of the ways above, replacing any earlier choice. */
export function mockReadiness(kind: keyof typeof readyz): void {
  server.use(readyz[kind]());
}
