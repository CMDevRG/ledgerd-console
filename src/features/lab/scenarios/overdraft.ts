import { check, Run } from '../steps';
import { createLabAccount, expectAnswer, readBalance, transfer } from '../helpers';
import type { Scenario } from '../types';

/** a. An account that may not go negative cannot be overdrawn, and a refusal changes nothing. */
export const overdraft: Scenario = {
  id: 'overdraft',
  title: 'Overdraft is refused and nothing changes',
  summary:
    'Funds a wallet that may not go negative with 100.00, then tries to withdraw 101.00. The withdrawal must be refused and the balance must still be 100.00.',
  async run(api, ids) {
    const run = new Run(api);
    const runId = ids.runId();
    let wallet = '';
    let bank = '';

    await run.step(
      'Create two lab accounts',
      'A wallet (a liability, balance may not go below zero) and a bank account (an asset, allowed to go negative so it can pay the deposit).',
      async (ctx) => {
        const w = await createLabAccount(ctx, runId, 'wallet', {
          type: 'LIABILITY',
          normalBalance: 'CREDIT',
          allowNegative: false,
        });
        const b = await createLabAccount(ctx, runId, 'bank', {
          type: 'ASSET',
          normalBalance: 'DEBIT',
          allowNegative: true,
        });
        wallet = w.account?.id ?? '';
        bank = b.account?.id ?? '';
        return [
          expectAnswer('Wallet created', '201', w.exchange),
          expectAnswer('Bank account created', '201', b.exchange),
        ];
      },
    );

    await run.step(
      'Fund the wallet with 100.00',
      'The bank is debited and the wallet credited by 10000 minor units (100.00 USD). Debits equal credits, so ledgerd accepts it.',
      async (ctx) => {
        const funded = await ctx.send({
          method: 'POST',
          path: '/v1/transactions',
          idempotencyKey: ids.key(),
          body: transfer(bank, wallet, '10000', { description: 'Lab: fund the wallet' }),
        });
        const { balance } = await readBalance(ctx, wallet);
        return [
          expectAnswer('Deposit accepted', '201', funded),
          check('Wallet balance after the deposit', '10000', balance ?? 'unreadable'),
        ];
      },
    );

    await run.step(
      'Try to withdraw 101.00',
      'The wallet is debited by 10100 and the bank credited. That would leave the wallet at -100 minor units, and a wallet may not go negative, so ledgerd refuses the whole transaction: insufficient funds.',
      async (ctx) => {
        const refused = await ctx.send({
          method: 'POST',
          path: '/v1/transactions',
          idempotencyKey: ids.key(),
          body: transfer(wallet, bank, '10100', { description: 'Lab: overdraft attempt' }),
        });
        return [expectAnswer('Withdrawal refused', '422 insufficient_funds', refused)];
      },
    );

    await run.step(
      'Check that nothing changed',
      'A refused transaction is not partly applied: both balances are exactly what they were.',
      async (ctx) => {
        const w = await readBalance(ctx, wallet);
        const b = await readBalance(ctx, bank);
        return [
          check('Wallet balance', '10000', w.balance ?? 'unreadable'),
          check('Bank balance', '10000', b.balance ?? 'unreadable'),
        ];
      },
    );

    return run.finish('overdraft');
  },
};
