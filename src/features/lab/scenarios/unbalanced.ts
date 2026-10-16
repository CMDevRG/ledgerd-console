import { balanceText, createAccountsStep, expectAnswer, postTransaction } from '../helpers';
import { check, Run } from '../steps';
import type { Scenario } from '../types';

/** d. A transaction whose debits and credits differ is refused. */
export const unbalanced: Scenario = {
  id: 'unbalanced',
  title: 'An unbalanced transaction is refused',
  summary:
    'Debits 100.00 and credits 99.99. Double entry requires them to be equal, so ledgerd must refuse it and record nothing.',
  async run(api, ids) {
    const run = new Run(api);
    const { wallet = '', bank = '' } = await createAccountsStep(run, ids.runId(), [
      { name: 'wallet', kind: 'wallet' },
      { name: 'bank', kind: 'bank' },
    ]);

    await run.step(
      'Send a transaction that debits 100.00 and credits 99.99',
      'One cent would appear from nowhere. The first rule of double entry is that, in every currency, the debits equal the credits, so ledgerd refuses before touching any balance.',
      async (ctx) => [
        expectAnswer(
          'Unbalanced transaction refused',
          '422 unbalanced_transaction',
          await postTransaction(ctx, ids.key(), {
            description: 'Lab: one cent too few',
            postings: [
              { account_id: bank, direction: 'DEBIT', amount: '10000', currency: 'USD' },
              { account_id: wallet, direction: 'CREDIT', amount: '9999', currency: 'USD' },
            ],
          }),
        ),
      ],
    );

    await run.step(
      'Check that nothing was recorded',
      'Both accounts are exactly as they were: zero.',
      async (ctx) => [
        check('Wallet balance', '0', await balanceText(ctx, wallet)),
        check('Bank balance', '0', await balanceText(ctx, bank)),
      ],
    );

    return run.finish('unbalanced');
  },
};
