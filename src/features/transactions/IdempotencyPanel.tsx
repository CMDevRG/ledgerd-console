import { useState } from 'react';
import { Link } from 'react-router';

import { Amount } from '../../ui/Amount';
import { ApiErrorView } from '../../ui/ApiErrorView';
import { Button } from '../../ui/Button';
import { CopyText } from '../../ui/CopyText';
import { useAnnounce } from '../../ui/LiveRegion';
import { Table, Td, Th } from '../../ui/Table';
import type { AccountRef } from './builder';
import { KeyNotice } from './KeyNotice';
import { useRepeat, type RepeatOutcome, type SentRequest } from './repeat';

interface IdempotencyPanelProps {
  sent: SentRequest;
  accounts: readonly AccountRef[];
}

/**
 * Shows the key a request went with and lets the person send the very same request again, to
 * see what ledgerd does with a repeat: nothing, if it recognises the key (R7.2, R7.3).
 */
export function IdempotencyPanel({ sent, accounts }: IdempotencyPanelProps) {
  const repeat = useRepeat();
  const announce = useAnnounce();
  const [outcomes, setOutcomes] = useState<RepeatOutcome[]>([]);

  const again = (): void => {
    repeat.mutate(sent, {
      onSuccess: (outcome) => {
        setOutcomes((all) => [...all, outcome]);
        announce(
          outcome.replayed
            ? 'Replay: ledgerd returned the first result and recorded nothing new'
            : 'Not a replay: ledgerd recorded a new transaction',
        );
      },
    });
  };

  return (
    <section
      aria-labelledby="idempotency"
      className="flex flex-col gap-3 border-t border-green-800 pt-3 dark:border-green-300"
    >
      <h3 id="idempotency" className="font-semibold">
        Idempotency
      </h3>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        This request was sent with the key{' '}
        <CopyText value={sent.key} label="idempotency key" head={12} tail={6} />
      </p>
      <p className="max-w-prose text-sm">
        Send it again, unchanged, to see what ledgerd does with a repeat. With the same key and the
        same content it must return the first result and record nothing new.
      </p>
      <div>
        <Button onClick={again} loading={repeat.isPending}>
          Send the same request again
        </Button>
      </div>

      {outcomes.map((outcome, index) => (
        <Outcome key={index} n={index + 1} outcome={outcome} accounts={accounts} />
      ))}

      {repeat.isError ? (
        <div className="flex flex-col gap-2">
          <ApiErrorView error={repeat.error} hideFieldErrors />
          <KeyNotice error={repeat.error} />
        </div>
      ) : null}
    </section>
  );
}

/** What one repeat showed. Exported for its own tests. */
export function Outcome({
  n,
  outcome,
  accounts,
}: {
  n: number;
  outcome: RepeatOutcome;
  accounts: readonly AccountRef[];
}) {
  const code = (id: string): string => accounts.find((a) => a.id === id)?.code ?? id.slice(0, 8);
  const moved = outcome.changes.some((c) => c.before !== c.after);

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border-2 p-3 text-sm ${
        outcome.replayed
          ? 'border-green-800 dark:border-green-300'
          : 'border-amber-700 dark:border-amber-300'
      }`}
    >
      <p className="font-semibold">
        Repeat {n}: HTTP {outcome.status}
        {outcome.replayed ? ' with Idempotent-Replayed: true' : ' without Idempotent-Replayed'}
      </p>
      {outcome.replayed ? (
        <p>
          <span aria-hidden="true">✓ </span>
          This was a replay. ledgerd recognised the key and returned the original transaction{' '}
          <Link to={`/transactions/${outcome.transactionId}`} className="font-mono underline">
            {outcome.transactionId.slice(0, 8)}…
          </Link>
          . It recorded nothing new.
        </p>
      ) : (
        <p>
          <span aria-hidden="true">! </span>
          This was not a replay. ledgerd treated it as a new request and recorded a new transaction{' '}
          <Link to={`/transactions/${outcome.transactionId}`} className="font-mono underline">
            {outcome.transactionId.slice(0, 8)}…
          </Link>
          . This happens when the key is no longer remembered, because ledgerd keeps keys only for a
          limited time.
        </p>
      )}
      <Table caption={`Balances before and after repeat ${String(n)}`} hideCaption>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th numeric>Before the repeat</Th>
            <Th numeric>After the repeat</Th>
            <Th>Changed?</Th>
          </tr>
        </thead>
        <tbody>
          {outcome.changes.map((change) => (
            <tr key={change.accountId}>
              <Td>
                <Link to={`/accounts/${change.accountId}`} className="font-mono underline">
                  {code(change.accountId)}
                </Link>
              </Td>
              <Td numeric>
                <Amount minor={change.before} currency={change.currency} />
              </Td>
              <Td numeric>
                <Amount minor={change.after} currency={change.currency} />
              </Td>
              <Td>{change.before === change.after ? 'No, unchanged' : 'Yes'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {outcome.replayed && moved ? (
        <p>
          A balance did change, but not because of this repeat: a replay records nothing. Another
          transaction was recorded in between.
        </p>
      ) : null}
    </div>
  );
}
