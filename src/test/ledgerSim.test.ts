import { beforeEach, describe, expect, it } from 'vitest';

import {
  createAccount,
  createTransaction,
  getAccount,
  getTransaction,
  listAccounts,
  reverseTransaction,
} from '../api/endpoints';
import { ApiError } from '../api/problem';
import { createLedgerSim, type LedgerSim } from './ledgerSim';

let sim: LedgerSim;
beforeEach(() => {
  sim = createLedgerSim();
  sim.install();
});

const move = (from: string, to: string, amount: string, currency = 'USD') => ({
  postings: [
    { account_id: to, direction: 'DEBIT' as const, amount, currency },
    { account_id: from, direction: 'CREDIT' as const, amount, currency },
  ],
});

const refusal = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
};

/** A sim is only worth testing against if it behaves like ledgerd; these check the rules it copies. */
describe('the ledger sim, used through the real API client', () => {
  it('creates accounts, refuses a duplicate code, and lists newest first', async () => {
    const a = await createAccount({
      code: 'a',
      currency: 'USD',
      type: 'ASSET',
      normal_balance: 'DEBIT',
      allow_negative: false,
    });
    await createAccount({
      code: 'b',
      currency: 'USD',
      type: 'LIABILITY',
      normal_balance: 'CREDIT',
      allow_negative: true,
    });
    expect(a.data.balance).toBe(0n);
    const dup = await refusal(
      createAccount({
        code: 'a',
        currency: 'EUR',
        type: 'ASSET',
        normal_balance: 'DEBIT',
        allow_negative: false,
      }),
    );
    expect(dup.code).toBe('account_code_exists');
    expect((await listAccounts()).data.accounts.map((x) => x.code)).toEqual(['b', 'a']);
  });

  it('moves money by the normal side and records the balance after each posting', async () => {
    const bank = sim.addAccount({
      code: 'bank',
      type: 'ASSET',
      normal_balance: 'DEBIT',
      allow_negative: true,
    });
    const wallet = sim.addAccount({ code: 'wallet', type: 'LIABILITY', normal_balance: 'CREDIT' });
    const result = await createTransaction(move(wallet.id, bank.id, '10000'), 'k1');
    expect(result.data.postings.map((p) => p.balance_after)).toEqual([10000n, 10000n]);
    expect(sim.balanceOf(bank.id)).toBe(10000n); // debit on a debit-normal account: up
    expect(sim.balanceOf(wallet.id)).toBe(10000n); // credit on a credit-normal account: up
    expect((await getAccount(bank.id)).data.balance).toBe(10000n);
    expect((await getTransaction(result.data.id)).data.id).toBe(result.data.id);
  });

  it('refuses an unbalanced transaction and changes nothing', async () => {
    const a = sim.addAccount({ code: 'a', allow_negative: true });
    const b = sim.addAccount({ code: 'b', allow_negative: true });
    const body = move(a.id, b.id, '100');
    const unbalanced = {
      postings: [body.postings[0], { ...body.postings[1], amount: '99' }],
    } as typeof body;
    const error = await refusal(createTransaction(unbalanced, 'k'));
    expect(error.code).toBe('unbalanced_transaction');
    expect(sim.balanceOf(a.id)).toBe(0n);
  });

  it('refuses an overdraft on the final balance, and the refused key stays usable', async () => {
    const poor = sim.addAccount({ code: 'poor' }); // may not go negative; debit-normal
    const rich = sim.addAccount({ code: 'rich', allow_negative: true });
    const overdraft = move(poor.id, rich.id, '500'); // credits poor: -500
    const error = await refusal(createTransaction(overdraft, 'same-key'));
    expect(error.code).toBe('insufficient_funds');
    expect(sim.balanceOf(poor.id)).toBe(0n);

    // The key was not used up: after funding, the very same key and request go through.
    await createTransaction(move(rich.id, poor.id, '1000'), 'fund');
    const ok = await createTransaction(overdraft, 'same-key');
    expect(ok.replayed).toBe(false);
    expect(sim.balanceOf(poor.id)).toBe(500n);
  });

  it('does not count an intermediate dip as an overdraft', async () => {
    const acct = sim.addAccount({ code: 'acct' });
    const other = sim.addAccount({ code: 'other', allow_negative: true });
    await createTransaction(move(other.id, acct.id, '100'), 'fund');
    const result = await createTransaction(
      {
        postings: [
          { account_id: acct.id, direction: 'CREDIT', amount: '150', currency: 'USD' }, // 100 - 150 = -50 for now
          { account_id: acct.id, direction: 'DEBIT', amount: '100', currency: 'USD' }, //  back to 50
          { account_id: other.id, direction: 'DEBIT', amount: '50', currency: 'USD' },
        ],
      },
      'dip',
    );
    expect(result.data.postings.map((p) => p.balance_after)).toEqual([-50n, 50n, -50n]);
    expect(sim.balanceOf(acct.id)).toBe(50n);
  });

  it('replays an identical repeat, and the balance does not move twice', async () => {
    const a = sim.addAccount({ code: 'a', allow_negative: true });
    const b = sim.addAccount({ code: 'b', allow_negative: true });
    const body = move(a.id, b.id, '100');
    const first = await createTransaction(body, 'k');
    const again = await createTransaction(body, 'k');
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.data.id).toBe(first.data.id);
    expect(sim.balanceOf(b.id)).toBe(100n);
    expect(sim.transactions()).toHaveLength(1);
  });

  it('refuses the same key with a different body', async () => {
    const a = sim.addAccount({ code: 'a', allow_negative: true });
    const b = sim.addAccount({ code: 'b', allow_negative: true });
    await createTransaction(move(a.id, b.id, '100'), 'k');
    const error = await refusal(createTransaction(move(a.id, b.id, '101'), 'k'));
    expect(error.code).toBe('idempotency_key_reuse');
    expect(sim.balanceOf(b.id)).toBe(100n);
  });

  it('demands a key', async () => {
    const a = sim.addAccount({ code: 'a', allow_negative: true });
    const b = sim.addAccount({ code: 'b', allow_negative: true });
    const error = await refusal(createTransaction(move(a.id, b.id, '1'), ''));
    expect(error.status).toBe(400);
  });

  it('reverses a transaction once, offsetting every posting, without touching the original', async () => {
    const a = sim.addAccount({ code: 'a', allow_negative: true });
    const b = sim.addAccount({ code: 'b', allow_negative: true });
    const original = await createTransaction(move(a.id, b.id, '100'), 'k');
    const reversal = await reverseTransaction(original.data.id, 'r1');
    expect(reversal.data.reverses_id).toBe(original.data.id);
    expect(reversal.data.postings.map((p) => p.direction)).toEqual(['CREDIT', 'DEBIT']);
    expect(sim.balanceOf(a.id)).toBe(0n);
    expect(sim.balanceOf(b.id)).toBe(0n);
    expect((await getTransaction(original.data.id)).data.postings).toEqual(original.data.postings);

    const twice = await refusal(reverseTransaction(original.data.id, 'r2'));
    expect(twice.code).toBe('already_reversed');
    expect(twice.status).toBe(409);
    // A repeat of the first reversal (same key) is a replay, not a second reversal.
    expect((await reverseTransaction(original.data.id, 'r1')).replayed).toBe(true);
  });

  it('knows nothing of an unknown transaction or account', async () => {
    expect((await refusal(getTransaction('40000000-0000-4000-8000-0000000000ff'))).status).toBe(
      404,
    );
    expect(
      (await refusal(reverseTransaction('40000000-0000-4000-8000-0000000000ff', 'r'))).status,
    ).toBe(404);
    expect((await refusal(getAccount('10000000-0000-4000-8000-0000000000ff'))).status).toBe(404);
    const a = sim.addAccount({ code: 'a' });
    const ghost = '10000000-0000-4000-8000-0000000000ff';
    expect((await refusal(createTransaction(move(a.id, ghost, '1'), 'k'))).status).toBe(404);
  });

  it('can be made to fail once, for tests of failures', async () => {
    const a = sim.addAccount({ code: 'a', allow_negative: true });
    const b = sim.addAccount({ code: 'b', allow_negative: true });
    sim.failNext(new Response('{"status":500}', { status: 500 }));
    await refusal(createTransaction(move(a.id, b.id, '1'), 'k')).catch(() => undefined);
    await createTransaction(move(a.id, b.id, '1'), 'k'); // the failure used up nothing
    expect(sim.transactions()).toHaveLength(1);
  });
});
