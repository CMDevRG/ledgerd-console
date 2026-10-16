import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createLedgerSim, type LedgerSim } from '../../../test/ledgerSim';
import { server } from '../../../test/server';
import { createLabApi } from '../api';
import { fixedIds } from '../testkit';
import { overdraft } from './overdraft';

let sim: LedgerSim;
beforeEach(() => {
  sim = createLedgerSim();
  sim.install();
});

const run = () => overdraft.run(createLabApi(), fixedIds());

describe('scenario a: overdraft', () => {
  it('behaves as designed against a ledger that keeps its promise', async () => {
    const result = await run();
    expect(result.verdict).toBe('as-designed');
    expect(result.steps.map((s) => s.title)).toEqual([
      'Create lab accounts',
      'Fund the wallet with 100.00',
      'Try to withdraw 101.00',
      'Check that nothing changed',
    ]);
    expect(result.steps.flatMap((s) => s.checks).every((c) => c.ok)).toBe(true);
    // And really did what it says: 100.00 in the wallet, a refused withdrawal recorded.
    expect(sim.balanceOf(sim.byCode('lab-r1-wallet').id)).toBe(10000n);
    expect(sim.transactions()).toHaveLength(1);
  });

  it('records every request: the account codes, the key, the amounts, the refusal', async () => {
    const result = await run();
    const withdraw = result.steps[2]?.exchanges[0];
    expect(withdraw).toMatchObject({
      method: 'POST',
      path: '/v1/transactions',
      requestHeaders: { 'idempotency-key': 'key-2' },
      status: 422,
    });
    expect(JSON.stringify(withdraw?.body)).toContain('"amount":"10100"');
    expect(withdraw?.responseBody).toMatchObject({ code: 'insufficient_funds' });
    expect(result.steps[0]?.exchanges.map((e) => (e.body as { code: string }).code)).toEqual([
      'lab-r1-wallet',
      'lab-r1-bank',
    ]);
  });

  it('uses its own accounts, with the lab- prefix and the run id, so two runs never collide', async () => {
    await overdraft.run(createLabApi(), fixedIds());
    const ids = fixedIds();
    ids.runId(); // a second run with a different id
    await overdraft.run(createLabApi(), ids);
    const codes = ['lab-r1-wallet', 'lab-r1-bank', 'lab-r2-wallet', 'lab-r2-bank'];
    for (const code of codes) expect(sim.byCode(code).code).toBe(code);
  });

  it('every step explains itself in words', async () => {
    const result = await run();
    for (const step of result.steps) expect(step.explanation.length).toBeGreaterThan(30);
  });

  describe('each check can fail (R9.4)', () => {
    it('against a ledger that lets the wallet go negative: unexpected, at the refusal check', async () => {
      sim.faults.allowOverdraft = true;
      const result = await run();
      expect(result.verdict).toBe('unexpected');
      const failed = result.steps.flatMap((s) => s.checks).filter((c) => !c.ok);
      expect(failed.map((c) => c.label)).toEqual([
        'Withdrawal refused',
        'Wallet balance',
        'Bank balance',
      ]);
      expect(failed[0]).toMatchObject({ expected: '422 insufficient_funds', actual: '201' });
    });

    it('against a ledger that refuses but half-applies: the refusal passes, the balance checks catch it', async () => {
      sim.faults.applyBeforeRefusing = true;
      const result = await run();
      expect(result.verdict).toBe('unexpected');
      const failed = result.steps.flatMap((s) => s.checks).filter((c) => !c.ok);
      expect(failed.map((c) => c.label)).toEqual(['Wallet balance', 'Bank balance']);
      expect(failed[0]).toMatchObject({ expected: '10000', actual: '-100' });
    });

    it('against a ledger that refuses to create accounts: unexpected, with the reason shown', async () => {
      server.use(
        http.post('*/api/v1/accounts', () =>
          HttpResponse.json(
            { code: 'internal_error', status: 500 },
            { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
          ),
        ),
      );
      const result = await run();
      expect(result.verdict).toBe('unexpected');
      expect(result.steps[0]?.checks.map((c) => c.actual)).toEqual([
        '500 internal_error',
        '500 internal_error',
      ]);
    });
  });

  it('is could-not-run, never as-designed, when ledgerd cannot be reached', async () => {
    server.use(http.post('*/api/v1/accounts', () => HttpResponse.error()));
    const result = await run();
    expect(result.verdict).toBe('could-not-run');
    expect(result.error).toMatch(/could not reach/i);
    expect(result.steps).toHaveLength(1);
  });
});
