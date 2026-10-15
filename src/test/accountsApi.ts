import { http, HttpResponse } from 'msw';

import type { components } from '../api/schema';
import { makeAccount, makeProblem, TIME } from './factories';
import { server } from './server';

type S = components['schemas'];
const PROBLEM = { 'Content-Type': 'application/problem+json' };

export interface AccountsApi {
  /** The accounts, newest first (the order ledgerd lists them in). */
  accounts: S['Account'][];
  /** Every list request received. */
  lists: URL[];
  /** Every body POSTed. */
  posts: unknown[];
  /** The next POST gets this answer instead of creating the account. */
  rejectNextPost: (response: Response) => void;
}

export interface AccountsApiOptions {
  /** Page size to use whatever `limit` asks (to make pagination easy to test). */
  pageSize?: number;
  /** Delay the answer to POST (milliseconds). */
  postDelayMs?: number;
}

/**
 * A small stand-in for ledgerd's account endpoints: list with a cursor and the two filters,
 * and create with the duplicate-code refusal. Anything else is up to the test.
 */
export function mockAccountsApi(
  initial: S['Account'][] = [],
  options: AccountsApiOptions = {},
): AccountsApi {
  const api: AccountsApi = {
    accounts: [...initial],
    lists: [],
    posts: [],
    rejectNextPost: (response) => {
      nextRejection = response;
    },
  };
  let nextRejection: Response | undefined;
  let counter = 0;

  server.use(
    http.get('*/api/v1/accounts', ({ request }) => {
      const url = new URL(request.url);
      api.lists.push(url);
      const prefix = url.searchParams.get('code_prefix') ?? '';
      const currency = url.searchParams.get('currency');
      const limit = options.pageSize ?? Number(url.searchParams.get('limit') ?? '50');
      const start = Number((url.searchParams.get('cursor') ?? 'c0').slice(1));
      const matching = api.accounts.filter(
        (a) => a.code.startsWith(prefix) && (currency === null || a.currency === currency),
      );
      const page = matching.slice(start, start + limit);
      const next = start + limit < matching.length ? `c${String(start + limit)}` : null;
      return HttpResponse.json({ accounts: page, next_cursor: next });
    }),

    http.post('*/api/v1/accounts', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      api.posts.push(body);
      if (options.postDelayMs !== undefined)
        await new Promise((r) => setTimeout(r, options.postDelayMs));
      if (nextRejection !== undefined) {
        const response = nextRejection;
        nextRejection = undefined;
        return response;
      }
      if (api.accounts.some((a) => a.code === body.code)) {
        return HttpResponse.json(
          makeProblem({
            type: 'urn:ledgerd:error:account_code_exists',
            title: 'Account code already exists',
            status: 409,
            code: 'account_code_exists',
          }),
          { status: 409, headers: PROBLEM },
        );
      }
      counter += 1;
      const account = makeAccount({
        id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
        code: body.code as string,
        currency: body.currency as string,
        type: body.type as S['AccountType'],
        normal_balance: body.normal_balance as S['Side'],
        allow_negative: body.allow_negative as boolean,
        balance: '0',
        last_posting_at: null,
        created_at: TIME,
      });
      api.accounts.unshift(account);
      return HttpResponse.json(account, {
        status: 201,
        headers: { Location: `/v1/accounts/${account.id}` },
      });
    }),
  );
  return api;
}

/** A refusal of the create form, as ledgerd sends it for a field error. */
export const validationRefusal = (errors: { field: string; message: string }[]): Response =>
  HttpResponse.json(makeProblem({ errors }), { status: 422, headers: PROBLEM });
