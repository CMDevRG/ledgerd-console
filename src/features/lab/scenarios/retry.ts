import {
  balanceText,
  createAccountsStep,
  expectAnswer,
  headerOf,
  idOf,
  postTransaction,
  transfer,
} from '../helpers';
import { check, Run } from '../steps';
import type { Exchange, Scenario } from '../types';

/** b. A retried request is a replay, not a second effect. */
export const retry: Scenario = {
  id: 'retry',
  title: 'A retried request is a replay, not a second effect',
  summary:
    'Sends the same deposit twice with the same Idempotency-Key. The second answer must be a replay of the first, with the same transaction id, and the balance must have changed only once.',
  async run(api, ids) {
    const run = new Run(api);
    const { wallet = '', bank = '' } = await createAccountsStep(run, ids.runId(), [
      { name: 'wallet', kind: 'wallet' },
      { name: 'bank', kind: 'bank' },
    ]);
    const key = ids.key();
    const body = transfer(bank, wallet, '10000', { description: 'Lab: deposit sent twice' });
    let first: Exchange | undefined;

    await run.step(
      'Send a deposit of 100.00',
      'The first request with this key is carried out normally.',
      async (ctx) => {
        first = await postTransaction(ctx, key, body);
        return [
          expectAnswer('Deposit accepted', '201', first),
          check('Not a replay', 'absent', headerOf(first, 'idempotent-replayed')),
          check('Wallet balance', '10000', await balanceText(ctx, wallet)),
        ];
      },
    );

    await run.step(
      'Send exactly the same request again',
      'Same key, same body: this is what a client does after a timeout, not knowing whether the first one arrived. ledgerd recognises the key and answers with the original result, marked Idempotent-Replayed: true. It does not post the money a second time.',
      async (ctx) => {
        const again = await postTransaction(ctx, key, body);
        return [
          expectAnswer('Repeat answered', '201', again),
          check('Marked as a replay', 'true', headerOf(again, 'idempotent-replayed')),
          check(
            'Same transaction as the first',
            idOf(first ?? again) ?? 'no id',
            idOf(again) ?? 'no id',
          ),
        ];
      },
    );

    await run.step(
      'Check that the money moved once',
      'If the repeat had been carried out, the wallet would hold 200.00. It still holds 100.00.',
      async (ctx) => [
        check('Wallet balance', '10000', await balanceText(ctx, wallet)),
        check('Bank balance', '10000', await balanceText(ctx, bank)),
      ],
    );

    return run.finish('retry');
  },
};
