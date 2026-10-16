import {
  balanceText,
  createAccountsStep,
  expectAnswer,
  namesField,
  postTransaction,
} from '../helpers';
import { check, Run } from '../steps';
import type { Scenario } from '../types';

/** e. An amount sent as a JSON number is refused. */
export const numberAmount: Scenario = {
  id: 'number-amount',
  title: 'An amount sent as a JSON number is refused',
  summary:
    'Sends "amount": 100 (a JSON number) instead of "100" (a string). ledgerd must refuse it and name the field, because many JSON parsers turn numbers into floating point and silently lose digits.',
  async run(api, ids) {
    const run = new Run(api);
    const { wallet = '', bank = '' } = await createAccountsStep(run, ids.runId(), [
      { name: 'wallet', kind: 'wallet' },
      { name: 'bank', kind: 'bank' },
    ]);

    await run.step(
      'Send a deposit with the amount as a JSON number',
      'The body has "amount": 100 for the first posting. A number is fine for 100, but ledgerd cannot know which numbers a client parsed without losing digits (above 2^53 a floating-point number cannot be exact). So the API takes amounts only as strings of digits, and refuses numbers outright.',
      async (ctx) => {
        const refused = await postTransaction(ctx, ids.key(), {
          description: 'Lab: amount as a number',
          postings: [
            { account_id: bank, direction: 'DEBIT', amount: 100, currency: 'USD' },
            { account_id: wallet, direction: 'CREDIT', amount: '100', currency: 'USD' },
          ],
        });
        return [
          expectAnswer('Number amount refused', '422 validation_error', refused),
          namesField(refused, 'postings[0].amount'),
        ];
      },
    );

    await run.step(
      'Check that nothing was recorded',
      'The refused request changed nothing: both accounts are exactly as they were.',
      async (ctx) => [
        check('Wallet balance', '0', await balanceText(ctx, wallet)),
        check('Bank balance', '0', await balanceText(ctx, bank)),
      ],
    );

    return run.finish('number-amount');
  },
};
