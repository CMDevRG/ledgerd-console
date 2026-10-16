import {
  balanceText,
  createAccountsStep,
  expectAnswer,
  postTransaction,
  transfer,
} from '../helpers';
import { check, Run } from '../steps';
import type { Scenario } from '../types';

/** a. An account that may not go negative cannot be overdrawn, and a refusal changes nothing. */
export const overdraft: Scenario = {
  id: 'overdraft',
  title: 'Overdraft is refused and nothing changes',
  summary:
    'Funds a wallet that may not go negative with 100.00, then tries to withdraw 101.00. The withdrawal must be refused and the balance must still be 100.00.',
  async run(api, ids) {
    const run = new Run(api);
    const { wallet = '', bank = '' } = await createAccountsStep(run, ids.runId(), [
      { name: 'wallet', kind: 'wallet' },
      { name: 'bank', kind: 'bank' },
    ]);

    await run.step(
      'Fund the wallet with 100.00',
      'The bank is debited and the wallet credited by 10000 minor units (100.00 USD). Debits equal credits, so ledgerd accepts it.',
      async (ctx) => {
        const funded = await postTransaction(
          ctx,
          ids.key(),
          transfer(bank, wallet, '10000', { description: 'Lab: fund the wallet' }),
        );
        return [
          expectAnswer('Deposit accepted', '201', funded),
          check('Wallet balance after the deposit', '10000', await balanceText(ctx, wallet)),
        ];
      },
    );

    await run.step(
      'Try to withdraw 101.00',
      'The wallet is debited by 10100 and the bank credited. That would leave the wallet at -100 minor units, and a wallet may not go negative, so ledgerd refuses the whole transaction: insufficient funds.',
      async (ctx) => {
        const refused = await postTransaction(
          ctx,
          ids.key(),
          transfer(wallet, bank, '10100', { description: 'Lab: overdraft attempt' }),
        );
        return [expectAnswer('Withdrawal refused', '422 insufficient_funds', refused)];
      },
    );

    await run.step(
      'Check that nothing changed',
      'A refused transaction is not partly applied: both balances are exactly what they were.',
      async (ctx) => [
        check('Wallet balance', '10000', await balanceText(ctx, wallet)),
        check('Bank balance', '10000', await balanceText(ctx, bank)),
      ],
    );

    return run.finish('overdraft');
  },
};
