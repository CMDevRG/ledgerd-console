import { http, HttpResponse, type JsonBodyType } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  createAccount,
  createTransaction,
  getAccount,
  getBalance,
  getReadiness,
  getTransaction,
  listAccounts,
  listPostings,
  reconcile,
  reverseTransaction,
} from './endpoints';
import { CONSOLE_HEADER } from './client';
import { ApiError } from './problem';
import {
  ID_A,
  ID_B,
  ID_TX,
  makeAccount,
  makeAccountsPage,
  makeBalance,
  makePosting,
  makePostingsPage,
  makeReport,
  makeTransaction,
} from '../test/factories';
import { server } from '../test/server';

describe('endpoints', () => {
  it('getReadiness', async () => {
    server.use(http.get('*/api/readyz', () => HttpResponse.json({ status: 'ready' })));
    expect((await getReadiness()).data).toEqual({ status: 'ready' });
  });

  it('listAccounts sends the filters and returns balances as bigint', async () => {
    let search = '';
    server.use(
      http.get('*/api/v1/accounts', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(
          makeAccountsPage([makeAccount({ balance: '9223372036854775809' })], 'next'),
        );
      }),
    );
    const { data } = await listAccounts({
      limit: 25,
      cursor: 'c1',
      codePrefix: 'lab-',
      currency: 'ETH',
    });
    expect(search).toBe('?limit=25&cursor=c1&code_prefix=lab-&currency=ETH');
    expect(data.next_cursor).toBe('next');
    expect(data.accounts[0]?.balance).toBe(9223372036854775809n); // beyond 2^53 and 2^63-1, exactly
  });

  it('listAccounts sends no query at all by default', async () => {
    let search = 'unset';
    server.use(
      http.get(
        '*/api/v1/accounts',
        ({ request }) => (
          (search = new URL(request.url).search),
          HttpResponse.json(makeAccountsPage())
        ),
      ),
    );
    await listAccounts();
    expect(search).toBe('');
  });

  it('createAccount posts the body and the console header', async () => {
    let seen: { body: unknown; header: string | null } | undefined;
    server.use(
      http.post('*/api/v1/accounts', async ({ request }) => {
        seen = { body: await request.json(), header: request.headers.get(CONSOLE_HEADER) };
        return HttpResponse.json(makeAccount(), { status: 201 });
      }),
    );
    const body = {
      code: 'c',
      currency: 'USD',
      type: 'ASSET',
      normal_balance: 'DEBIT',
      allow_negative: false,
    } as const;
    const result = await createAccount(body);
    expect(seen).toEqual({ body, header: '1' });
    expect(result.status).toBe(201);
  });

  it('getAccount and getTransaction read by id', async () => {
    server.use(
      http.get(`*/api/v1/accounts/${ID_A}`, () => HttpResponse.json(makeAccount())),
      http.get(`*/api/v1/transactions/${ID_TX}`, () => HttpResponse.json(makeTransaction())),
    );
    expect((await getAccount(ID_A)).data.id).toBe(ID_A);
    expect((await getTransaction(ID_TX)).data.postings).toHaveLength(2);
  });

  it('getBalance passes as_of only when given', async () => {
    const searches: string[] = [];
    server.use(
      http.get(`*/api/v1/accounts/${ID_A}/balance`, ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json(makeBalance({ balance: '-5' }));
      }),
    );
    const { data } = await getBalance(ID_A);
    await getBalance(ID_A, '2026-10-01T10:00:00Z');
    expect(searches).toEqual(['', '?as_of=2026-10-01T10%3A00%3A00Z']);
    expect(data.balance).toBe(-5n);
  });

  it('listPostings returns amounts and balances as bigint', async () => {
    server.use(
      http.get(`*/api/v1/accounts/${ID_A}/postings`, () =>
        HttpResponse.json(
          makePostingsPage(
            [makePosting({ amount: '1000000000000000000000000000000', balance_after: '-1' })],
            'older',
          ),
        ),
      ),
    );
    const { data } = await listPostings(ID_A, { limit: 50 });
    expect(data.postings[0]?.amount).toBe(10n ** 30n);
    expect(data.postings[0]?.balance_after).toBe(-1n);
    expect(data.next_cursor).toBe('older');
  });

  it('createTransaction sends the idempotency key and reports a replay', async () => {
    let key: string | null = null;
    server.use(
      http.post('*/api/v1/transactions', ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json(makeTransaction(), {
          status: 201,
          headers: { 'Idempotent-Replayed': 'true', Location: `/api/v1/transactions/${ID_TX}` },
        });
      }),
    );
    const body = {
      postings: [
        { account_id: ID_B, direction: 'DEBIT', amount: '10000', currency: 'USD' },
        { account_id: ID_A, direction: 'CREDIT', amount: '10000', currency: 'USD' },
      ],
    } as const;
    const result = await createTransaction({ postings: [...body.postings] }, 'key-123');
    expect(key).toBe('key-123');
    expect(result.replayed).toBe(true);
    expect(result.location).toBe(`/api/v1/transactions/${ID_TX}`);
  });

  it('reverseTransaction posts with the key and no body', async () => {
    let seen: { key: string | null; body: string } | undefined;
    server.use(
      http.post(`*/api/v1/transactions/${ID_TX}/reverse`, async ({ request }) => {
        seen = { key: request.headers.get('Idempotency-Key'), body: await request.text() };
        return HttpResponse.json(makeTransaction({ reverses_id: ID_TX }), { status: 201 });
      }),
    );
    const result = await reverseTransaction(ID_TX, 'rev-1');
    expect(seen).toEqual({ key: 'rev-1', body: '' });
    expect(result.data.reverses_id).toBe(ID_TX);
  });

  it('reconcile asks for a deep run only when told to, and converts every amount', async () => {
    const searches: string[] = [];
    server.use(
      http.post('*/api/v1/reconciliations', ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json(
          makeReport({
            deep: true,
            ok: false,
            mismatches: [
              { account_id: ID_A, code: 'w', currency: 'USD', stored: '8', expected: '5' },
            ],
            chain_breaks: [{ posting_id: 7, account_id: ID_B, recorded: '1', expected: '2' }],
          }),
        );
      }),
    );
    const { data } = await reconcile(true);
    await reconcile(false);
    expect(searches).toEqual(['?deep=true', '?deep=false']);
    expect(data.mismatches[0]).toMatchObject({ stored: 8n, expected: 5n });
    expect(data.chain_breaks[0]).toMatchObject({ recorded: 1n, expected: 2n });
    expect(data.currencies[0]).toMatchObject({ debits: 10000n, credits: 10000n });
  });
});

describe('responses are checked against the documented shape', () => {
  const broken: [string, () => Promise<unknown>, JsonBodyType][] = [
    [
      'an account with a balance that is not digits',
      () => getAccount(ID_A),
      { ...makeAccount(), balance: '12.5' },
    ],
    [
      'an account with an unknown type',
      () => getAccount(ID_A),
      { ...makeAccount(), type: 'REVENUE' },
    ],
    [
      'an account missing a field',
      () => getAccount(ID_A),
      Object.fromEntries(Object.entries(makeAccount()).filter(([key]) => key !== 'code')),
    ],
    ['an upper-case id', () => getAccount(ID_A), { ...makeAccount(), id: ID_A.toUpperCase() }],
    [
      'a timestamp with the wrong precision',
      () => getAccount(ID_A),
      { ...makeAccount(), created_at: '2026-10-13T15:04:05Z' },
    ],
  ];
  it.each(broken)('rejects %s', async (_name, call, body) => {
    server.use(http.get('*/api/v1/accounts/:id', () => HttpResponse.json(body)));
    await expect(call()).rejects.toMatchObject({ kind: 'unexpected' });
    await expect(call()).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects a posting amount of zero or with a sign', async () => {
    for (const amount of ['0', '-5', '007', '1.5']) {
      server.use(
        http.get(`*/api/v1/accounts/${ID_A}/postings`, () =>
          HttpResponse.json(makePostingsPage([makePosting({ amount })])),
        ),
      );
      await expect(listPostings(ID_A)).rejects.toMatchObject({ kind: 'unexpected' });
    }
  });
});
