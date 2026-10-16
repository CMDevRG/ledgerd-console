import {
  balanceText,
  createAccountsStep,
  expectAnswer,
  postTransaction,
  transfer,
} from '../helpers';
import { check, Run } from '../steps';
import type { Scenario } from '../types';

/** c. The same key with a different body is refused. */
export const keyReuse: Scenario = {
  id: 'key-reuse',
  title: 'The same key with a different request is refused',
  summary:
    'Sends a deposit of 100.00, then a deposit of 200.00 with the same Idempotency-Key. The second must be refused and the balance must stay at 100.00.',
  async run(api, ids) {
    const run = new Run(api);
    const { wallet = '', bank = '' } = await createAccountsStep(run, ids.runId(), [
      { name: 'wallet', kind: 'wallet' },
      { name: 'bank', kind: 'bank' },
    ]);
    const key = ids.key();

    await run.step(
      'Send a deposit of 100.00',
      'The first request with this key is carried out, and ledgerd remembers the key together with what the request said.',
      async (ctx) => [
        expectAnswer(
          'Deposit accepted',
          '201',
          await postTransaction(ctx, key, transfer(bank, wallet, '10000')),
        ),
        check('Wallet balance', '10000', await balanceText(ctx, wallet)),
      ],
    );

    await run.step(
      'Send a deposit of 200.00 with the same key',
      'A key stands for one request. Reusing it for something different is almost certainly a client bug, so ledgerd refuses rather than guess whether to apply it or to return the old result.',
      async (ctx) => [
        expectAnswer(
          'Different request refused',
          '422 idempotency_key_reuse',
          await postTransaction(ctx, key, transfer(bank, wallet, '20000')),
        ),
      ],
    );

    await run.step(
      'Check that nothing changed',
      'The refused request did not move any money.',
      async (ctx) => [
        check('Wallet balance', '10000', await balanceText(ctx, wallet)),
        check('Bank balance', '10000', await balanceText(ctx, bank)),
      ],
    );

    return run.finish('key-reuse');
  },
};
