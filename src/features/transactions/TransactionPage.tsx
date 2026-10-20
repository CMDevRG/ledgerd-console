import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { ApiError } from '../../api/problem';
import type { Transaction } from '../../api/schemas';
import { PageHeading } from '../../app/PageHeading';
import { Amount } from '../../ui/Amount';
import { ApiErrorView } from '../../ui/ApiErrorView';
import { Button } from '../../ui/Button';
import { CopyText } from '../../ui/CopyText';
import { Dialog } from '../../ui/Dialog';
import { useAnnounce } from '../../ui/LiveRegion';
import { QueryView } from '../../ui/QueryView';
import { Table, Td, Th } from '../../ui/Table';
import { Time } from '../../ui/Time';
import { UUID } from './ids';
import { useAccountCodes, useReverse, useTransaction } from './hooks';
import { IdempotencyKeyField } from './IdempotencyKeyField';
import { newIdempotencyKey, validateKey } from './key';
import { KeyNotice } from './KeyNotice';

export default function TransactionPage() {
  const { id = '' } = useParams();
  const valid = UUID.test(id);
  const transaction = useTransaction(id, valid);
  const notFound =
    transaction.error instanceof ApiError &&
    transaction.error.status === 404 &&
    transaction.data === undefined;

  return (
    <>
      <PageHeading title={transaction.data ? `Transaction ${id.slice(0, 8)}` : 'Transaction'} />
      <p className="mb-4">
        <Link to="/transactions" className="underline">
          ← Find another transaction
        </Link>
      </p>
      {!valid ? (
        <Missing reason="This is not a valid transaction id." />
      ) : notFound ? (
        <Missing reason="There is no transaction with this id." />
      ) : (
        <QueryView
          query={{
            data: transaction.data?.data,
            error: transaction.error,
            isError: transaction.isError,
            isFetching: transaction.isFetching,
            refetch: transaction.refetch,
          }}
          what="the transaction"
        >
          {(data) => <TransactionView transaction={data} />}
        </QueryView>
      )}
    </>
  );
}

function Missing({ reason }: { reason: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border-2 border-red-800 bg-red-50 p-4 text-sm text-red-950 dark:border-red-300 dark:bg-red-950 dark:text-red-50"
    >
      <p className="text-base font-semibold">Transaction not found</p>
      <p>
        {reason} Check the id, or{' '}
        <Link to="/transactions" className="underline">
          look for another
        </Link>
        .
      </p>
    </div>
  );
}

function TransactionView({ transaction }: { transaction: Transaction }) {
  const codes = useAccountCodes(transaction.postings.map((p) => p.account_id));
  const [reversing, setReversing] = useState(false);
  const [reversal, setReversal] = useState<Transaction | undefined>(undefined);
  const announce = useAnnounce();

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="details" className="flex flex-col gap-3">
        <h2 id="details" className="text-lg font-semibold">
          Details
        </h2>
        <dl className="grid max-w-2xl grid-cols-[max-content_minmax(0,1fr)] [&_dd]:[overflow-wrap:anywhere] gap-x-6 gap-y-2 text-sm">
          <dt className="font-medium text-slate-700 dark:text-slate-300">Id</dt>
          <dd>
            <CopyText value={transaction.id} label="transaction id" head={12} tail={6} />
          </dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Description</dt>
          <dd>{transaction.description === '' ? 'None' : transaction.description}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Recorded</dt>
          <dd>
            <Time iso={transaction.created_at} />
          </dd>
          {transaction.reverses_id === null ? null : (
            <>
              <dt className="font-medium text-slate-700 dark:text-slate-300">Reverses</dt>
              <dd>
                <Link
                  to={`/transactions/${transaction.reverses_id}`}
                  className="font-mono underline"
                >
                  {transaction.reverses_id}
                </Link>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section aria-labelledby="postings" className="flex flex-col gap-3">
        <h2 id="postings" className="text-lg font-semibold">
          Postings
        </h2>
        <Table caption="Postings of the transaction" hideCaption>
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
                    {codes.get(posting.account_id) ?? `${posting.account_id.slice(0, 8)}…`}
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
      </section>

      {reversal === undefined ? null : (
        <div
          role="status"
          className="rounded-md border-2 border-green-800 bg-green-50 p-3 text-sm text-green-950 dark:border-green-300 dark:bg-green-950 dark:text-green-50"
        >
          <span aria-hidden="true">✓ </span>
          Reversed by transaction{' '}
          <Link to={`/transactions/${reversal.id}`} className="font-mono underline">
            {reversal.id}
          </Link>
          . This transaction is unchanged; the new one posts the opposite directions, and the
          balances have been updated.
        </div>
      )}

      <section aria-labelledby="reverse" className="flex flex-col gap-2">
        <h2 id="reverse" className="text-lg font-semibold">
          Reverse
        </h2>
        <p className="max-w-prose text-sm">
          A recorded transaction is never edited. To undo one, ledgerd records a new transaction
          with the opposite directions.
        </p>
        <div>
          <Button
            variant="danger"
            onClick={() => {
              setReversing(true);
            }}
          >
            Reverse this transaction
          </Button>
        </div>
      </section>

      <Dialog
        open={reversing}
        title="Reverse this transaction?"
        onClose={() => {
          setReversing(false);
        }}
      >
        <ReverseForm
          transaction={transaction}
          onCancel={() => {
            setReversing(false);
          }}
          onDone={(created) => {
            setReversing(false);
            setReversal(created);
            announce('Transaction reversed');
          }}
        />
      </Dialog>
    </div>
  );
}

/**
 * The confirmation. It is only on screen while the dialog is open, so each time it opens it
 * starts with a new key, and keeps that key across retries within the same opening.
 */
function ReverseForm({
  transaction,
  onCancel,
  onDone,
}: {
  transaction: Transaction;
  onCancel: () => void;
  onDone: (reversal: Transaction) => void;
}) {
  const reverse = useReverse();
  const [key, setKey] = useState(() => newIdempotencyKey());
  const keyError = validateKey(key);
  const [showKeyError, setShowKeyError] = useState(false);

  const send = (): void => {
    if (keyError !== undefined) {
      setShowKeyError(true);
      return;
    }
    reverse.mutate(
      { id: transaction.id, key, accountIds: transaction.postings.map((p) => p.account_id) },
      {
        onSuccess: ({ data }) => {
          onDone(data);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        The original transaction will <strong>not</strong> be changed. A new transaction will be
        created that posts the opposite direction on each account, which undoes its effect on the
        balances.
      </p>
      <IdempotencyKeyField
        value={key}
        error={showKeyError ? keyError : undefined}
        onChange={(next) => {
          setKey(next);
          setShowKeyError(false);
        }}
        onNewKey={() => {
          setKey(newIdempotencyKey());
          setShowKeyError(false);
        }}
      />
      {reverse.isError ? (
        <div className="flex flex-col gap-3">
          <ApiErrorView error={reverse.error} hideFieldErrors />
          <KeyNotice
            error={reverse.error}
            onNewKey={() => {
              setKey(newIdempotencyKey());
            }}
          />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={send} loading={reverse.isPending}>
          Reverse transaction
        </Button>
      </div>
    </div>
  );
}
