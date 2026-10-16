import {
  balanceText,
  createAccountsStep,
  expectAnswer,
  idOf,
  postTransaction,
  reverse,
  transfer,
} from '../helpers';
import { check, Run } from '../steps';
import type { Scenario } from '../types';

/** g. A transaction can be reversed once. */
export const doubleReversal: Scenario = {
  id: 'double-reversal',
  title: 'A transaction cannot be reversed twice',
  summary:
    'Deposits 100.00, reverses the deposit, then reverses it again. The first reversal must work and undo the deposit; the second must be refused.',
  async run(api, ids) {
    const run = new Run(api);
    const { wallet = '', bank = '' } = await createAccountsStep(run, ids.runId(), [
      { name: 'wallet', kind: 'wallet' },
      { name: 'bank', kind: 'bank' },
    ]);
    let deposit = '';

    await run.step(
      'Deposit 100.00',
      'An ordinary deposit, to have something to reverse.',
      async (ctx) => {
        const sent = await postTransaction(ctx, ids.key(), transfer(bank, wallet, '10000'));
        deposit = idOf(sent) ?? '';
        return [
          expectAnswer('Deposit accepted', '201', sent),
          check('Wallet balance', '10000', await balanceText(ctx, wallet)),
        ];
      },
    );

    await run.step(
      'Reverse the deposit',
      'A ledger is append-only: nothing is edited or deleted. Reversing records a new transaction that posts the opposite direction on each account, which brings the balances back.',
      async (ctx) => {
        const reversal = await reverse(ctx, deposit, ids.key());
        const body = reversal.responseBody;
        const reverses =
          typeof body === 'object' &&
          body !== null &&
          'reverses_id' in body &&
          typeof body.reverses_id === 'string'
            ? body.reverses_id
            : 'none';
        return [
          expectAnswer('Reversal accepted', '201', reversal),
          check('It reverses the deposit', deposit, reverses),
          check('Wallet balance', '0', await balanceText(ctx, wallet)),
        ];
      },
    );

    await run.step(
      'Try to reverse it again',
      'Reversing twice would undo the deposit twice and take money that was never there. ledgerd allows one reversal per transaction and refuses the second with 409 already_reversed.',
      async (ctx) => [
        expectAnswer(
          'Second reversal refused',
          '409 already_reversed',
          await reverse(ctx, deposit, ids.key()),
        ),
        check('Wallet balance', '0', await balanceText(ctx, wallet)),
        check('Bank balance', '0', await balanceText(ctx, bank)),
      ],
    );

    return run.finish('double-reversal');
  },
};
