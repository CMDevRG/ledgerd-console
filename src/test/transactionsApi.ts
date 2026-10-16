import { http, HttpResponse } from 'msw';

import type { components } from '../api/schema';
import { makeProblem, TIME } from './factories';
import { server } from './server';

type S = components['schemas'];
const PROBLEM = { 'Content-Type': 'application/problem+json' };

export interface SentTransaction {
  body: S['CreateTransactionRequest'];
  key: string | null;
}

export interface TransactionsApi {
  /** Every POST received, with the Idempotency-Key it carried. */
  posts: SentTransaction[];
  /** The next POST gets this answer instead of being checked and recorded. */
  rejectNext: (response: Response) => void;
}

/**
 * A stand-in for POST /v1/transactions: it refuses what does not balance, as ledgerd does
 * (422 unbalanced_transaction), and otherwise records the postings.
 */
export function mockTransactionsApi(options: { delayMs?: number } = {}): TransactionsApi {
  let rejection: Response | undefined;
  const api: TransactionsApi = {
    posts: [],
    rejectNext: (response) => {
      rejection = response;
    },
  };
  let counter = 0;

  server.use(
    http.post('*/api/v1/transactions', async ({ request }) => {
      const body = (await request.json()) as S['CreateTransactionRequest'];
      api.posts.push({ body, key: request.headers.get('Idempotency-Key') });
      if (options.delayMs !== undefined) await new Promise((r) => setTimeout(r, options.delayMs));
      if (rejection !== undefined) {
        const response = rejection;
        rejection = undefined;
        return response;
      }

      const totals = new Map<string, bigint>();
      for (const p of body.postings) {
        const sign = p.direction === 'DEBIT' ? 1n : -1n;
        totals.set(p.currency, (totals.get(p.currency) ?? 0n) + sign * BigInt(p.amount));
      }
      const off = [...totals].find(([, difference]) => difference !== 0n);
      if (off !== undefined) {
        return HttpResponse.json(
          makeProblem({
            type: 'urn:ledgerd:error:unbalanced_transaction',
            title: 'Transaction is not balanced',
            status: 422,
            code: 'unbalanced_transaction',
            detail: `debits and credits differ in ${off[0]} by ${(off[1] < 0n ? -off[1] : off[1]).toString()}`,
            request_id: 'req-unbalanced-0001',
          }),
          { status: 422, headers: PROBLEM },
        );
      }

      counter += 1;
      const id = `40000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      const transaction: S['Transaction'] = {
        id,
        description: body.description ?? '',
        reverses_id: null,
        created_at: TIME,
        postings: body.postings.map((p, i) => ({
          id: counter * 10 + i,
          transaction_id: id,
          account_id: p.account_id,
          direction: p.direction,
          amount: p.amount,
          currency: p.currency,
          balance_after: p.amount,
          recorded_at: TIME,
        })),
      };
      return HttpResponse.json(transaction, {
        status: 201,
        headers: { Location: `/v1/transactions/${id}` },
      });
    }),
  );
  return api;
}
