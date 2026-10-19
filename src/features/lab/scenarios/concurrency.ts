import {
  balanceText,
  createAccountsStep,
  describeAnswer,
  expectAnswer,
  postTransaction,
  transfer,
} from '../helpers';
import { check, Run } from '../steps';
import type { Scenario } from '../types';

/** How many withdrawals are sent, and how many the balance can pay. */
export const WITHDRAWALS = 30;
const FUNDS = '10000'; // 100.00
const EACH = '1000'; // 10.00
export const PAYABLE = 10;

/** h. Many withdrawals at the same moment succeed exactly as often as the balance allows. */
export const concurrency: Scenario = {
  id: 'concurrency',
  title: 'Simultaneous withdrawals never overdraw',
  summary:
    'Funds a wallet with 100.00 and sends 30 withdrawals of 10.00 at the same moment. Exactly 10 may succeed, 20 must be refused, and the wallet must end at exactly zero.',
  async run(api, ids) {
    const run = new Run(api);
    const { wallet = '', bank = '' } = await createAccountsStep(run, ids.runId(), [
      { name: 'wallet', kind: 'wallet' },
      { name: 'bank', kind: 'bank' },
    ]);

    await run.step(
      'Fund the wallet with 100.00',
      'Enough for exactly ten withdrawals of 10.00.',
      async (ctx) => [
        expectAnswer(
          'Deposit accepted',
          '201',
          await postTransaction(ctx, ids.key(), transfer(bank, wallet, FUNDS)),
        ),
        check('Wallet balance', FUNDS, await balanceText(ctx, wallet)),
      ],
    );

    await run.step(
      `Send ${String(WITHDRAWALS)} withdrawals of 10.00 at once`,
      'Every request is started without waiting for any answer. A careless ledger would read the balance (100.00) for each of them before any had been paid, and let them all through. ledgerd locks the account while it decides, so each request sees the balance left by the ones before it: ten fit, the other twenty are refused.',
      async (ctx) => {
        const keys = Array.from({ length: WITHDRAWALS }, () => ids.key());
        const { value: answers, peak } = await ctx.observe(() =>
          Promise.all(
            keys.map((key, i) =>
              postTransaction(
                ctx,
                key,
                transfer(wallet, bank, EACH, {
                  description: `Lab: withdrawal ${String(i + 1)} of ${String(WITHDRAWALS)}`,
                }),
              ),
            ),
          ),
        );

        const accepted = answers.filter((a) => describeAnswer(a) === '201').length;
        const refused = answers.filter(
          (a) => describeAnswer(a) === '422 insufficient_funds',
        ).length;
        ctx.note(
          `Requests started together: ${String(WITHDRAWALS)}. Accepted: ${String(accepted)}. Refused for insufficient funds: ${String(refused)}.`,
        );
        ctx.note(
          peak === undefined
            ? 'The browser did not report timings, so the concurrency actually achieved is unknown.'
            : `Most requests on the network at the same time, as the browser reported: ${String(peak)}.`,
        );
        ctx.note(
          'A browser sends only a few requests to one host at once (6 for HTTP/1.1); the others wait for a free connection. So the real concurrency is bounded by that limit, not by the 30 started. The promise does not depend on it: with any amount of concurrency, ledgerd must never accept more than the balance pays.',
        );

        return [
          check('Accepted', String(PAYABLE), String(accepted)),
          check('Refused for insufficient funds', String(WITHDRAWALS - PAYABLE), String(refused)),
          check('Any other answer', '0', String(WITHDRAWALS - accepted - refused)),
        ];
      },
    );

    await run.step(
      'Check the balances',
      'Ten withdrawals of 10.00 took exactly the 100.00 there was. The wallet is at zero, never below, and the bank is back at zero too: it received the deposit and paid out the ten withdrawals.',
      async (ctx) => [
        check('Wallet balance', '0', await balanceText(ctx, wallet)),
        check('Bank balance', '0', await balanceText(ctx, bank)),
      ],
    );

    return run.finish('concurrency');
  },
};
