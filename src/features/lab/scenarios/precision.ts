import {
  balanceText,
  createAccountsStep,
  expectAnswer,
  namesField,
  postTransaction,
  transfer,
} from '../helpers';
import { check, Run } from '../steps';
import type { Scenario } from '../types';

const CASES = [
  {
    name: 'two53',
    amount: '9007199254740993',
    label: '2^53 + 1',
    why: 'The first integer a 64-bit float cannot hold: as a double it would become 9007199254740992.',
  },
  {
    name: 'two63',
    amount: '9223372036854775808',
    label: '2^63',
    why: 'One more than the largest signed 64-bit integer, so a database BIGINT column would overflow.',
  },
  {
    name: 'ten30',
    amount: '1000000000000000000000000000000',
    label: '10^30',
    why: 'The largest amount ledgerd accepts in one posting: 31 digits.',
  },
] as const;

/** f. Large amounts are stored exactly, and one above the limit is refused. */
export const precision: Scenario = {
  id: 'precision',
  title: 'Huge amounts are exact, and the limit is enforced',
  summary:
    'Deposits 2^53+1, 2^63 and 10^30 minor units and reads each balance back digit for digit, then tries 10^30+1, which must be refused.',
  async run(api, ids) {
    const run = new Run(api);
    const made = await createAccountsStep(run, ids.runId(), [
      { name: 'bank', kind: 'bank' },
      ...CASES.map((c) => ({ name: c.name, kind: 'wallet' as const })),
      { name: 'over', kind: 'wallet' },
    ]);
    const bank = made.bank ?? '';

    for (const c of CASES) {
      await run.step(
        `Deposit ${c.label} (${c.amount})`,
        `${c.why} The balance must read back as exactly ${c.amount}.`,
        async (ctx) => {
          const wallet = made[c.name] ?? '';
          const deposited = await postTransaction(ctx, ids.key(), transfer(bank, wallet, c.amount));
          return [
            expectAnswer('Deposit accepted', '201', deposited),
            check('Balance, digit for digit', c.amount, await balanceText(ctx, wallet)),
          ];
        },
      );
    }

    await run.step(
      'Try to deposit 10^30 + 1',
      'One above the limit. It is refused, with the amount field named, and nothing is recorded.',
      async (ctx) => {
        const over = made.over ?? '';
        const refused = await postTransaction(
          ctx,
          ids.key(),
          transfer(bank, over, '1000000000000000000000000000001'),
        );
        return [
          expectAnswer('Amount above the limit refused', '422 validation_error', refused),
          namesField(refused, 'postings[0].amount'),
          check('Balance of that account', '0', await balanceText(ctx, over)),
        ];
      },
    );

    return run.finish('precision');
  },
};
