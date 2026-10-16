import { Link } from 'react-router';

import type { Transaction } from '../../api/schemas';
import { Amount } from '../../ui/Amount';
import { Button } from '../../ui/Button';
import { CopyText } from '../../ui/CopyText';
import { Table, Td, Th } from '../../ui/Table';
import { Time } from '../../ui/Time';
import type { AccountRef } from './builder';
import { IdempotencyPanel } from './IdempotencyPanel';
import type { SentRequest } from './repeat';

interface ResultViewProps {
  transaction: Transaction;
  /** The accounts of the request, to show codes instead of ids. */
  accounts: readonly AccountRef[];
  /** The request as sent, for "send the same request again". */
  sent: SentRequest;
  onDismiss: () => void;
}

/** What ledgerd accepted: the transaction, each posting, and the balance after each. */
export function ResultView({ transaction, accounts, sent, onDismiss }: ResultViewProps) {
  const code = (id: string): string => accounts.find((a) => a.id === id)?.code ?? id.slice(0, 8);

  return (
    <section
      aria-labelledby="result"
      className="flex flex-col gap-3 rounded-md border-2 border-green-800 bg-green-50 p-4 text-green-950 dark:border-green-300 dark:bg-green-950 dark:text-green-50"
    >
      <h2 id="result" className="text-lg font-semibold">
        <span aria-hidden="true">✓ </span>Transaction posted
      </h2>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Transaction{' '}
        <Link to={`/transactions/${transaction.id}`} className="font-mono underline">
          {transaction.id}
        </Link>
        <CopyText value={transaction.id} label="transaction id" />
        <span>
          recorded at <Time iso={transaction.created_at} />
        </span>
      </p>
      {transaction.description === '' ? null : <p>“{transaction.description}”</p>}
      <Table caption="Postings and the balance after each" hideCaption>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Direction</Th>
            <Th numeric>Amount</Th>
            <Th numeric>Balance after</Th>
          </tr>
        </thead>
        <tbody>
          {transaction.postings.map((posting) => (
            <tr key={posting.id}>
              <Td>
                <Link to={`/accounts/${posting.account_id}`} className="font-mono underline">
                  {code(posting.account_id)}
                </Link>
              </Td>
              <Td>{posting.direction === 'DEBIT' ? 'Debit' : 'Credit'}</Td>
              <Td numeric>
                <Amount minor={posting.amount} currency={posting.currency} />
              </Td>
              <Td numeric>
                <Amount minor={posting.balance_after} currency={posting.currency} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-sm">The balances of these accounts have been updated.</p>
      <IdempotencyPanel sent={sent} accounts={accounts} />
      <div>
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </section>
  );
}
