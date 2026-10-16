import { http, HttpResponse, type HttpHandler } from 'msw';

import type { components } from '../api/schema';
import { TIME } from './factories';
import { server } from './server';

type S = components['schemas'];
const PROBLEM = { 'Content-Type': 'application/problem+json' };

interface SimAccount {
  account: S['Account'];
  balance: bigint;
}

interface Remembered {
  fingerprint: string;
  transaction: S['Transaction'];
}

export interface SimRequest {
  method: string;
  path: string;
  key: string | null;
  body: unknown;
}

/**
 * Ways to make the sim behave wrongly, on purpose. A Lab scenario must be able to tell a ledger
 * that keeps its promises from one that does not; tests turn these on to prove that each check
 * can fail.
 */
export interface Faults {
  /** Lets an account that may not go negative go negative. */
  allowOverdraft: boolean;
  /** Refuses an overdraft, but only after applying it (a half-done transaction). */
  applyBeforeRefusing: boolean;
}

export interface LedgerSim {
  /** Behaviour switches for tests of the Lab: all off by default. */
  faults: Faults;
  /** Every write the sim received, in order. */
  requests: SimRequest[];
  /** The id of every account read with GET /v1/accounts/{id}, in order. */
  accountReads: string[];
  /** Creates an account directly (not through the API), e.g. to set a test up. */
  addAccount: (account: Partial<S['Account']> & { code: string }) => S['Account'];
  /** The balance of an account, in minor units. */
  balanceOf: (id: string) => bigint;
  /** The account with this code. */
  byCode: (code: string) => S['Account'];
  transactions: () => S['Transaction'][];
  /** Forgets every idempotency key, as ledgerd does once they expire. */
  forgetKeys: () => void;
  /** The next write to this path gets this answer and changes nothing. */
  failNext: (response: Response) => void;
  /** Delay every write (milliseconds). */
  delayMs: number;
  install: () => void;
}

const problem = (
  code: string,
  title: string,
  status: number,
  detail: string,
  errors?: { field: string; message: string }[],
): Response =>
  HttpResponse.json(
    {
      type: `urn:ledgerd:error:${code}`,
      title,
      status,
      code,
      detail,
      request_id: `req-${code}-0001`,
      ...(errors ? { errors } : {}),
    },
    { status, headers: PROBLEM },
  );

/**
 * A small working ledger behind the same HTTP interface as ledgerd, following its rules:
 * balanced per currency, balances move by the normal side, an account that may not go negative
 * cannot (judged on the final balance), idempotency keys with replay and reuse refusal where a
 * refused request does not use its key up, and a transaction can be reversed once.
 *
 * It exists so tests can exercise real flows (a deposit, an overdraft, a repeat, a reversal)
 * without one hand-written answer per test. It is not ledgerd: the end-to-end tests are the
 * ones that run against the real service.
 */
export function createLedgerSim(): LedgerSim {
  const accounts = new Map<string, SimAccount>();
  const newestFirst: string[] = [];
  const transactions = new Map<string, S['Transaction']>();
  const reversed = new Set<string>();
  const keys = new Map<string, Remembered>();
  let accountCounter = 0;
  let transactionCounter = 0;
  let postingCounter = 0;
  let failure: Response | undefined;

  const sim: LedgerSim = {
    faults: { allowOverdraft: false, applyBeforeRefusing: false },
    requests: [],
    accountReads: [],
    delayMs: 0,
    forgetKeys: () => {
      keys.clear();
    },
    failNext: (response) => {
      failure = response;
    },
    addAccount: (partial) => {
      accountCounter += 1;
      const account: S['Account'] = {
        id: `10000000-0000-4000-8000-${String(accountCounter).padStart(12, '0')}`,
        currency: 'USD',
        type: 'ASSET',
        normal_balance: 'DEBIT',
        allow_negative: false,
        balance: '0',
        last_posting_at: null,
        created_at: TIME,
        ...partial,
      };
      accounts.set(account.id, { account, balance: BigInt(account.balance) });
      newestFirst.unshift(account.id);
      return account;
    },
    balanceOf: (id) => accounts.get(id)?.balance ?? 0n,
    byCode: (code) => {
      const found = [...accounts.values()].find((a) => a.account.code === code);
      if (found === undefined) throw new Error(`no account ${code}`);
      return view(found);
    },
    transactions: () => [...transactions.values()],
    install: () => {
      server.use(...handlers());
    },
  };

  const view = (a: SimAccount): S['Account'] => ({ ...a.account, balance: a.balance.toString() });

  /** Records a transaction atomically, or says why it cannot be. */
  function apply(
    request: S['CreateTransactionRequest'],
    reversesId: string | null,
  ): { ok: true; transaction: S['Transaction'] } | { ok: false; response: Response } {
    const debits = new Map<string, bigint>();
    for (const p of request.postings) {
      const delta = BigInt(p.amount) * (p.direction === 'DEBIT' ? 1n : -1n);
      debits.set(p.currency, (debits.get(p.currency) ?? 0n) + delta);
    }
    const off = [...debits].find(([, d]) => d !== 0n);
    if (off !== undefined) {
      return {
        ok: false,
        response: problem(
          'unbalanced_transaction',
          'Transaction is not balanced',
          422,
          `for ${off[0]}, total debits differ from total credits`,
        ),
      };
    }
    const running = new Map<string, bigint>();
    const lines: S['Posting'][] = [];
    const id = `40000000-0000-4000-8000-${String(transactionCounter + 1).padStart(12, '0')}`;
    for (const [i, p] of request.postings.entries()) {
      const target = accounts.get(p.account_id);
      if (target === undefined) {
        return {
          ok: false,
          response: problem('not_found', 'Not found', 404, `account ${p.account_id} not found`),
        };
      }
      if (target.account.currency !== p.currency) {
        return {
          ok: false,
          response: problem(
            'validation_error',
            'Validation failed',
            422,
            'one or more fields are invalid',
            [
              {
                field: `postings[${String(i)}].currency`,
                message: `posting currency ${p.currency} does not match account currency ${target.account.currency}`,
              },
            ],
          ),
        };
      }
      const before = running.get(p.account_id) ?? target.balance;
      const after =
        p.direction === target.account.normal_balance
          ? before + BigInt(p.amount)
          : before - BigInt(p.amount);
      running.set(p.account_id, after);
      postingCounter += 1;
      lines.push({
        id: postingCounter,
        transaction_id: id,
        account_id: p.account_id,
        direction: p.direction,
        amount: p.amount,
        currency: p.currency,
        balance_after: after.toString(),
        recorded_at: TIME,
      });
    }
    for (const [accountId, balance] of running) {
      const a = accounts.get(accountId);
      if (
        a !== undefined &&
        !a.account.allow_negative &&
        balance < 0n &&
        !sim.faults.allowOverdraft
      ) {
        if (sim.faults.applyBeforeRefusing) {
          for (const [id, b] of running) {
            const target = accounts.get(id);
            if (target !== undefined) target.balance = b;
          }
        }
        return {
          ok: false,
          response: problem(
            'insufficient_funds',
            'Insufficient funds',
            422,
            `account ${accountId} would be overdrawn by ${(-balance).toString()}`,
          ),
        };
      }
    }
    // Committed: nothing above changed anything, so a refusal leaves no trace.
    transactionCounter += 1;
    for (const [accountId, balance] of running) {
      const a = accounts.get(accountId);
      if (a !== undefined) {
        a.balance = balance;
        a.account = { ...a.account, last_posting_at: TIME };
      }
    }
    const transaction: S['Transaction'] = {
      id,
      description: request.description ?? '',
      reverses_id: reversesId,
      created_at: TIME,
      postings: lines,
    };
    transactions.set(id, transaction);
    return { ok: true, transaction };
  }

  /** Runs a write under an Idempotency-Key. */
  function idempotent(
    scope: string,
    key: string | null,
    body: unknown,
    run: () => { ok: true; transaction: S['Transaction'] } | { ok: false; response: Response },
  ): Response {
    if (key === null || !/^[\x21-\x7E]{1,255}$/.test(key)) {
      return problem(
        'malformed_request',
        'Malformed request',
        400,
        'a valid Idempotency-Key header is required',
      );
    }
    const fingerprint = `${scope}\n${JSON.stringify(body)}`;
    const remembered = keys.get(key);
    if (remembered !== undefined) {
      if (remembered.fingerprint !== fingerprint) {
        return problem(
          'idempotency_key_reuse',
          'Idempotency key reused with a different request',
          422,
          'this Idempotency-Key was already used with a different request',
        );
      }
      return HttpResponse.json(remembered.transaction, {
        status: 201,
        headers: {
          'Idempotent-Replayed': 'true',
          Location: `/v1/transactions/${remembered.transaction.id}`,
        },
      });
    }
    const outcome = run();
    if (!outcome.ok) return outcome.response; // a refusal does not use the key up
    keys.set(key, { fingerprint, transaction: outcome.transaction });
    return HttpResponse.json(outcome.transaction, {
      status: 201,
      headers: { Location: `/v1/transactions/${outcome.transaction.id}` },
    });
  }

  function handlers(): HttpHandler[] {
    const guard = async (
      path: string,
      key: string | null,
      body: unknown,
    ): Promise<Response | undefined> => {
      sim.requests.push({ method: 'POST', path, key, body });
      if (sim.delayMs > 0) await new Promise((r) => setTimeout(r, sim.delayMs));
      if (failure !== undefined) {
        const response = failure;
        failure = undefined;
        return response;
      }
      return undefined;
    };

    return [
      http.get('*/api/v1/accounts', ({ request }) => {
        const url = new URL(request.url);
        const prefix = url.searchParams.get('code_prefix') ?? '';
        const currency = url.searchParams.get('currency');
        const limit = Number(url.searchParams.get('limit') ?? '50');
        const start = Number((url.searchParams.get('cursor') ?? 'c0').slice(1));
        const all = newestFirst
          .map((id) => accounts.get(id))
          .filter((a): a is SimAccount => a !== undefined)
          .filter(
            (a) =>
              a.account.code.startsWith(prefix) &&
              (currency === null || a.account.currency === currency),
          );
        const page = all.slice(start, start + limit).map(view);
        return HttpResponse.json({
          accounts: page,
          next_cursor: start + limit < all.length ? `c${String(start + limit)}` : null,
        });
      }),

      http.post('*/api/v1/accounts', async ({ request }) => {
        const body = (await request.json()) as S['CreateAccountRequest'];
        sim.requests.push({ method: 'POST', path: '/v1/accounts', key: null, body });
        if ([...accounts.values()].some((a) => a.account.code === body.code)) {
          return problem(
            'account_code_exists',
            'Account code already exists',
            409,
            'an account with this code already exists',
          );
        }
        const created = sim.addAccount({ ...body });
        return HttpResponse.json(created, {
          status: 201,
          headers: { Location: `/v1/accounts/${created.id}` },
        });
      }),

      http.get('*/api/v1/accounts/:id', ({ params }) => {
        sim.accountReads.push(String(params.id));
        const found = accounts.get(String(params.id));
        return found === undefined
          ? problem('not_found', 'Not found', 404, 'account not found')
          : HttpResponse.json(view(found));
      }),

      http.post('*/api/v1/transactions', async ({ request }) => {
        const body = (await request.json()) as S['CreateTransactionRequest'];
        const key = request.headers.get('Idempotency-Key');
        const early = await guard('/v1/transactions', key, body);
        if (early) return early;
        return idempotent('create', key, body, () => apply(body, null));
      }),

      http.get('*/api/v1/transactions/:id', ({ params }) => {
        const found = transactions.get(String(params.id));
        return found === undefined
          ? problem('not_found', 'Not found', 404, 'transaction not found')
          : HttpResponse.json(found);
      }),

      http.post('*/api/v1/transactions/:id/reverse', async ({ request, params }) => {
        const id = String(params.id);
        const key = request.headers.get('Idempotency-Key');
        const early = await guard(`/v1/transactions/${id}/reverse`, key, null);
        if (early) return early;
        return idempotent(`reverse:${id}`, key, null, () => {
          const original = transactions.get(id);
          if (original === undefined)
            return {
              ok: false,
              response: problem('not_found', 'Not found', 404, 'transaction not found'),
            };
          if (reversed.has(id)) {
            return {
              ok: false,
              response: problem(
                'already_reversed',
                'Transaction already reversed',
                409,
                'this transaction has already been reversed',
              ),
            };
          }
          const outcome = apply(
            {
              description: `Reversal of ${id}`,
              postings: original.postings.map((p) => ({
                account_id: p.account_id,
                direction: p.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
                amount: p.amount,
                currency: p.currency,
              })),
            },
            id,
          );
          if (outcome.ok) reversed.add(id);
          return outcome;
        });
      }),
    ];
  }

  return sim;
}
