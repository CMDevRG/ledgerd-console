import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createLedgerSim, type Faults, type LedgerSim } from '../../../test/ledgerSim';
import { server } from '../../../test/server';
import { createLabApi } from '../api';
import { fixedIds } from '../testkit';
import type { Check, Scenario, ScenarioResult } from '../types';
import { concurrency, PAYABLE, WITHDRAWALS } from './concurrency';
import { doubleReversal } from './doubleReversal';
import { SCENARIOS } from './index';
import { keyReuse } from './keyReuse';
import { numberAmount } from './numberAmount';
import { precision } from './precision';
import { retry } from './retry';
import { unbalanced } from './unbalanced';

let sim: LedgerSim;
beforeEach(() => {
  sim = createLedgerSim();
  sim.install();
});

const run = (scenario: Scenario): Promise<ScenarioResult> =>
  scenario.run(createLabApi(), fixedIds());
const checksOf = (result: ScenarioResult): Check[] => result.steps.flatMap((s) => s.checks);
const failed = (result: ScenarioResult): Check[] => checksOf(result).filter((c) => !c.ok);

describe('every scenario', () => {
  it.each(SCENARIOS.map((s) => [s.title, s] as const))(
    '%s: behaves as designed against a ledger that keeps its promises',
    async (_title, scenario) => {
      const result = await run(scenario);
      expect(failed(result)).toEqual([]);
      expect(result.verdict).toBe('as-designed');
      expect(result.id).toBe(scenario.id);
      expect(checksOf(result).length).toBeGreaterThanOrEqual(4);
    },
  );

  it.each(SCENARIOS.map((s) => [s.title, s] as const))(
    '%s: explains every step in words',
    async (_title, scenario) => {
      for (const step of (await run(scenario)).steps) {
        expect(step.title.length).toBeGreaterThan(5);
        expect(step.explanation.length).toBeGreaterThan(40);
      }
    },
  );

  it.each(SCENARIOS.map((s) => [s.title, s] as const))(
    "%s: touches only its own lab- accounts, and leaves the user's alone (R9.2)",
    async (_title, scenario) => {
      const mine = sim.addAccount({
        code: 'user-wallet',
        normal_balance: 'CREDIT',
        type: 'LIABILITY',
      });
      const before = sim.balanceOf(mine.id);
      await run(scenario);
      const created = sim.requests
        .filter((r) => r.path === '/v1/accounts')
        .map((r) => (r.body as { code: string }).code);
      expect(created.length).toBeGreaterThan(0);
      for (const code of created) expect(code, code).toMatch(/^lab-r1-/);
      expect(sim.balanceOf(mine.id)).toBe(before);
      for (const tx of sim.transactions()) {
        expect(tx.postings.some((p) => p.account_id === mine.id)).toBe(false);
      }
    },
  );

  it.each(SCENARIOS.map((s) => [s.title, s] as const))(
    '%s: every write carries an Idempotency-Key',
    async (_title, scenario) => {
      await run(scenario);
      const writes = sim.requests.filter((r) => r.path !== '/v1/accounts');
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) expect(w.key, w.path).toMatch(/^key-\d+$/);
    },
  );

  it.each(SCENARIOS.map((s) => [s.title, s] as const))(
    '%s: is could-not-run, never as-designed, when ledgerd cannot be reached',
    async (_title, scenario) => {
      server.use(http.post('*/api/v1/accounts', () => HttpResponse.error()));
      const result = await run(scenario);
      expect(result.verdict).toBe('could-not-run');
      expect(result.error).toBeDefined();
    },
  );

  it('are all listed once, with distinct ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'overdraft',
      'retry',
      'key-reuse',
      'unbalanced',
      'number-amount',
      'precision',
      'double-reversal',
      'concurrency',
    ]);
  });
});

/**
 * Against a ledger that breaks the promise a scenario is about, the scenario must say
 * "unexpected" and name the broken check. This is what shows the checks can fail (R9.4).
 */
describe('against a ledger that breaks its promises', () => {
  const broken: [Scenario, keyof Faults, string[]][] = [
    [
      retry,
      'ignoreIdempotency',
      ['Marked as a replay', 'Same transaction as the first', 'Wallet balance', 'Bank balance'],
    ],
    [keyReuse, 'ignoreKeyReuse', ['Different request refused', 'Wallet balance', 'Bank balance']],
    [
      unbalanced,
      'skipBalanceCheck',
      ['Unbalanced transaction refused', 'Wallet balance', 'Bank balance'],
    ],
    [
      numberAmount,
      'acceptNumberAmounts',
      ['Number amount refused', 'The error names the field', 'Wallet balance', 'Bank balance'],
    ],
    [doubleReversal, 'allowDoubleReversal', ['Second reversal refused']],
    [
      concurrency,
      'staleOverdraftCheck',
      ['Accepted', 'Refused for insufficient funds', 'Wallet balance', 'Bank balance'],
    ],
  ];

  it.each(
    broken.map(([scenario, fault, labels]) => [scenario.title, fault, scenario, labels] as const),
  )(
    '%s: unexpected with the %s fault, naming what broke',
    async (_title, fault, scenario, labels) => {
      sim.faults[fault] = true;
      const result = await run(scenario);
      expect(result.verdict).toBe('unexpected');
      expect(failed(result).map((c) => c.label)).toEqual(labels);
    },
  );

  it('retry: the repeat was carried out again, and the checks show it', async () => {
    sim.faults.ignoreIdempotency = true;
    const result = await run(retry);
    const byLabel = Object.fromEntries(failed(result).map((c) => [c.label, c]));
    expect(byLabel['Marked as a replay']).toMatchObject({ expected: 'true', actual: 'absent' });
    expect(byLabel['Wallet balance']).toMatchObject({ expected: '10000', actual: '20000' });
  });

  it('key reuse: the different request was carried out, and the balance shows it', async () => {
    sim.faults.ignoreKeyReuse = true;
    const result = await run(keyReuse);
    expect(failed(result)[0]).toMatchObject({
      expected: '422 idempotency_key_reuse',
      actual: '201',
    });
    expect(failed(result).find((c) => c.label === 'Wallet balance')).toMatchObject({
      expected: '10000',
      actual: '30000',
    });
  });

  it('unbalanced: the one cent that came from nowhere is visible in the balances', async () => {
    sim.faults.skipBalanceCheck = true;
    const result = await run(unbalanced);
    expect(failed(result).map((c) => c.actual)).toEqual(['201', '9999', '10000']);
  });

  it('number amount: both the status and the missing field name are caught', async () => {
    sim.faults.acceptNumberAmounts = true;
    const result = await run(numberAmount);
    expect(
      failed(result)
        .slice(0, 2)
        .map((c) => [c.expected, c.actual]),
    ).toEqual([
      ['422 validation_error', '201'],
      ['postings[0].amount', 'none'],
    ]);
  });

  it('precision: a ledger that keeps amounts as floating point is caught, digit for digit', async () => {
    sim.faults.lossyAmounts = true;
    const result = await run(precision);
    expect(result.verdict).toBe('unexpected');
    expect(failed(result).map((c) => [c.expected, c.actual])).toEqual([
      ['9007199254740993', '9007199254740992'], // 2^53 + 1 became 2^53
      ['1000000000000000000000000000000', '1000000000000000019884624838656'], // 10^30 in a double
    ]);
    // 2^63 is a power of two, which a double does hold exactly: that check rightly passes.
  });

  it('precision: a ledger with no upper limit is caught at 10^30 + 1', async () => {
    sim.faults.noAmountLimit = true;
    const result = await run(precision);
    expect(failed(result).map((c) => c.label)).toEqual([
      'Amount above the limit refused',
      'The error names the field',
      'Balance of that account',
    ]);
    expect(failed(result)[0]).toMatchObject({ expected: '422 validation_error', actual: '201' });
  });
});

describe('scenario h: concurrency', () => {
  it('sends all the withdrawals before any answer arrives, and exactly ten are accepted', async () => {
    const result = await run(concurrency);
    expect(result.verdict).toBe('as-designed');
    const withdrawals = result.steps[2]?.exchanges ?? [];
    expect(withdrawals).toHaveLength(WITHDRAWALS);
    expect(withdrawals.filter((e) => e.status === 201)).toHaveLength(PAYABLE);
    expect(withdrawals.filter((e) => e.status === 422)).toHaveLength(WITHDRAWALS - PAYABLE);
    // Thirty different keys: they are thirty different requests, not retries of one.
    const keys = new Set(withdrawals.map((e) => e.requestHeaders['idempotency-key']));
    expect(keys.size).toBe(WITHDRAWALS);
    expect(sim.transactions()).toHaveLength(1 + PAYABLE);
  });

  it('says how many were accepted and refused, and what the browser limit means (R9.5)', async () => {
    const notes = (await run(concurrency)).steps[2]?.notes ?? [];
    expect(notes[0]).toBe(
      'Requests started together: 30. Accepted: 10. Refused for insufficient funds: 20.',
    );
    expect(notes.join(' ')).toMatch(/6 for HTTP\/1\.1/);
    expect(notes.join(' ')).toMatch(/bounded by that limit/);
  });

  it('says so when the browser gave no timings, rather than inventing a number', async () => {
    const notes = (await run(concurrency)).steps[2]?.notes ?? [];
    expect(notes[1]).toBe(
      'The browser did not report timings, so the concurrency actually achieved is unknown.',
    );
  });

  it('reports the peak the browser measured, when it measured one', async () => {
    const api = createLabApi({
      now: () => 0,
      getEntriesByType: () =>
        Array.from({ length: 30 }, (_, i) => ({
          name: 'http://localhost/api/v1/transactions',
          initiatorType: 'fetch',
          startTime: 1,
          requestStart: 2 + Math.floor(i / 6) * 10,
          responseEnd: 2 + Math.floor(i / 6) * 10 + 9,
        })),
    });
    const result = await concurrency.run(api, fixedIds());
    expect(result.steps[2]?.notes[1]).toBe(
      'Most requests on the network at the same time, as the browser reported: 6.',
    );
  });

  it('with a ledger that checks the balance before the others are paid, the overdraft is caught', async () => {
    sim.faults.staleOverdraftCheck = true;
    const result = await run(concurrency);
    expect(result.verdict).toBe('unexpected');
    const byLabel = Object.fromEntries(failed(result).map((c) => [c.label, c]));
    expect(byLabel.Accepted).toMatchObject({ expected: '10', actual: '30' });
    expect(byLabel['Refused for insufficient funds']).toMatchObject({
      expected: '20',
      actual: '0',
    });
    expect(byLabel['Wallet balance']).toMatchObject({ expected: '0', actual: '-20000' }); // overdrawn by 200.00
  });
});

describe('what each scenario actually does to the ledger', () => {
  it('retry: one transaction, one deposit', async () => {
    await run(retry);
    expect(sim.transactions()).toHaveLength(1);
    expect(sim.requests.filter((r) => r.path === '/v1/transactions')).toHaveLength(2);
  });

  it('key reuse: one transaction, the second request recorded nothing', async () => {
    await run(keyReuse);
    expect(sim.transactions()).toHaveLength(1);
  });

  it('unbalanced and number-amount: nothing recorded at all', async () => {
    await run(unbalanced);
    await run(numberAmount);
    expect(sim.transactions()).toHaveLength(0);
  });

  it('precision: three deposits, exactly', async () => {
    await run(precision);
    expect(sim.transactions().map((t) => t.postings[0]?.amount)).toEqual([
      '9007199254740993',
      '9223372036854775808',
      '1000000000000000000000000000000',
    ]);
  });

  it('double reversal: the deposit and one reversal, linked', async () => {
    await run(doubleReversal);
    const [deposit, reversal, ...rest] = sim.transactions();
    expect(rest).toEqual([]);
    expect(reversal?.reverses_id).toBe(deposit?.id);
  });
});
