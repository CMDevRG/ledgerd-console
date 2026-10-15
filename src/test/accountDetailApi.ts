import { http, HttpResponse } from 'msw';

import type { components } from '../api/schema';
import { makePosting, makeProblem } from './factories';
import { server } from './server';

type S = components['schemas'];
const PROBLEM = { 'Content-Type': 'application/problem+json' };

export interface DetailApi {
  account: S['Account'];
  /** Newest first, as ledgerd lists them. */
  postings: S['Posting'][];
  accountRequests: number;
  balanceRequests: URL[];
  postingRequests: URL[];
  /** Records a new posting as someone else's transaction would. */
  record: (posting: S['Posting']) => void;
}

export interface DetailOptions {
  /** The moment the stand-in treats as "now" (for instants in the future). */
  now?: string;
  /** Page size to use whatever `limit` asks. */
  pageSize?: number;
}

const ms = (iso: string): number => Date.parse(iso);

/** A posting with an id and time, newest ids last in time. */
export const posting = (id: number, overrides: Partial<S['Posting']> = {}): S['Posting'] =>
  makePosting({
    id,
    transaction_id: `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    recorded_at: `2026-10-13T15:${String(id).padStart(2, '0')}:00.000000Z`,
    ...overrides,
  });

/**
 * A stand-in for ledgerd's read endpoints for one account: the account (with the current
 * balance of its newest posting), the balance as of an instant, and the postings with a
 * keyset cursor, as the real service answers them.
 */
export function mockAccountDetail(
  account: S['Account'],
  postings: S['Posting'][],
  options: DetailOptions = {},
): DetailApi {
  const now = options.now ?? '2026-10-13T16:00:00.000000Z';
  const api: DetailApi = {
    account,
    postings: [...postings],
    accountRequests: 0,
    balanceRequests: [],
    postingRequests: [],
    record: (p) => {
      api.postings.unshift(p);
      api.account = { ...api.account, balance: p.balance_after, last_posting_at: p.recorded_at };
    },
  };

  server.use(
    http.get('*/api/v1/accounts/:id', ({ params }) => {
      api.accountRequests += 1;
      if (params.id !== api.account.id) {
        return HttpResponse.json(
          makeProblem({ status: 404, code: 'not_found', title: 'Account not found' }),
          { status: 404, headers: PROBLEM },
        );
      }
      return HttpResponse.json(api.account);
    }),

    http.get('*/api/v1/accounts/:id/balance', ({ request }) => {
      const url = new URL(request.url);
      api.balanceRequests.push(url);
      const asOf = url.searchParams.get('as_of');
      const base = { account_id: api.account.id, currency: api.account.currency };
      if (asOf === null || ms(asOf) > ms(now)) {
        return HttpResponse.json({
          ...base,
          balance: api.account.balance,
          last_posting_at: api.account.last_posting_at,
          as_of: null,
        });
      }
      if (Number.isNaN(ms(asOf))) {
        return HttpResponse.json(
          makeProblem({ errors: [{ field: 'as_of', message: 'must be an RFC 3339 timestamp' }] }),
          { status: 422, headers: PROBLEM },
        );
      }
      const at = api.postings.find((p) => ms(p.recorded_at) <= ms(asOf));
      return HttpResponse.json({
        ...base,
        balance: at?.balance_after ?? '0',
        last_posting_at: at?.recorded_at ?? null,
        // ledgerd writes every timestamp in UTC with microseconds.
        as_of: new Date(ms(asOf)).toISOString().replace('Z', '000Z'),
      });
    }),

    http.get('*/api/v1/accounts/:id/postings', ({ request }) => {
      const url = new URL(request.url);
      api.postingRequests.push(url);
      const limit = options.pageSize ?? Number(url.searchParams.get('limit') ?? '50');
      const cursor = url.searchParams.get('cursor');
      // The cursor is the id of the last posting of the page before: older ones follow it.
      const after = cursor === null ? Infinity : Number(cursor.slice(1));
      const older = api.postings.filter((p) => p.id < after);
      const page = older.slice(0, limit);
      const last = page.at(-1);
      const next = older.length > limit && last !== undefined ? `p${String(last.id)}` : null;
      return HttpResponse.json({ postings: page, next_cursor: next });
    }),
  );
  return api;
}
