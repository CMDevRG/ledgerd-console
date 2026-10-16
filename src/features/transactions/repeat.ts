import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createTransaction, getAccount, type CreateTransactionBody } from '../../api/endpoints';
import { refreshAfterTransaction } from '../accounts/detailHooks';

/** A request exactly as it was sent: the body and the key. A repeat sends these unchanged. */
export interface SentRequest {
  body: CreateTransactionBody;
  key: string;
}

export interface BalanceChange {
  accountId: string;
  currency: string;
  before: bigint;
  after: bigint;
}

export interface RepeatOutcome {
  /** ledgerd said it recognised the key and returned the first result. */
  replayed: boolean;
  status: number;
  transactionId: string;
  requestId: string | undefined;
  /** The balances of the accounts involved, read just before and just after the repeat. */
  changes: BalanceChange[];
}

/** The current balances of some accounts, read from ledgerd (not from the page's cache). */
async function readBalances(
  ids: readonly string[],
): Promise<Map<string, { balance: bigint; currency: string }>> {
  const unique = [...new Set(ids)];
  const accounts = await Promise.all(unique.map((id) => getAccount(id)));
  return new Map(
    accounts.map(({ data }) => [data.id, { balance: data.balance, currency: data.currency }]),
  );
}

/**
 * Sends a request again, byte for byte, and reports what ledgerd did with it: a replay of the
 * first result, or a new transaction, and how the balances moved (they must not move on a replay).
 */
export function useRepeat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (sent: SentRequest): Promise<RepeatOutcome> => {
      const ids = sent.body.postings.map((p) => p.account_id);
      const before = await readBalances(ids);
      const result = await createTransaction(sent.body, sent.key);
      const after = await readBalances(ids);
      return {
        replayed: result.replayed,
        status: result.status,
        transactionId: result.data.id,
        requestId: result.requestId,
        changes: [...before].map(([accountId, was]) => ({
          accountId,
          currency: was.currency,
          before: was.balance,
          after: after.get(accountId)?.balance ?? was.balance,
        })),
      };
    },
    onSuccess: async (_outcome, sent) => {
      await refreshAfterTransaction(
        client,
        sent.body.postings.map((p) => p.account_id),
      );
    },
  });
}
