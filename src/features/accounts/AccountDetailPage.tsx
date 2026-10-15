import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { PageHeading } from '../../app/PageHeading';
import { ApiError } from '../../api/problem';
import type { Account, Balance, Posting } from '../../api/schemas';
import { Amount } from '../../ui/Amount';
import { ApiErrorView } from '../../ui/ApiErrorView';
import { Button } from '../../ui/Button';
import { CopyText } from '../../ui/CopyText';
import { Field, Input } from '../../ui/Field';
import { useAnnounce } from '../../ui/LiveRegion';
import { QueryView } from '../../ui/QueryView';
import { Loading } from '../../ui/Status';
import { Table, Td, Th } from '../../ui/Table';
import { Time } from '../../ui/Time';
import { AS_OF_RULE, parseAsOf } from './asOf';
import {
  useAccount,
  useBalanceAt,
  usePostings,
  useRefreshHistoryOnNewPosting,
} from './detailHooks';
import { intermediatePostingIds } from './postings';
import { SIDE_LABELS, TYPE_LABELS } from './rules';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default function AccountDetailPage() {
  const { id = '' } = useParams();
  const validId = UUID.test(id);
  const account = useAccount(id, validId);
  useRefreshHistoryOnNewPosting(id, account.data?.data.last_posting_at);

  const title = account.data ? `Account ${account.data.data.code}` : 'Account';
  return (
    <>
      <PageHeading title={title} />
      <p className="mb-4">
        <Link to="/accounts" className="underline">
          ← All accounts
        </Link>
      </p>

      {!validId ? (
        <Missing reason="This is not a valid account id." />
      ) : account.error instanceof ApiError && account.error.status === 404 && !account.data ? (
        <Missing reason="There is no account with this id." />
      ) : (
        <QueryView
          query={{
            data: account.data?.data,
            error: account.error,
            isError: account.isError,
            isFetching: account.isFetching,
            refetch: account.refetch,
          }}
          what="the account"
        >
          {(data) => (
            <div className="flex flex-col gap-8">
              <Summary account={data} />
              <AsOfPanel account={data} />
              <History account={data} />
            </div>
          )}
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
      <p className="text-base font-semibold">Account not found</p>
      <p>
        {reason} It may have been mistyped. Choose an account from the{' '}
        <Link to="/accounts" className="underline">
          list of accounts
        </Link>
        .
      </p>
    </div>
  );
}

function Summary({ account }: { account: Account }) {
  return (
    <section aria-labelledby="summary" className="flex flex-col gap-4">
      <h2 id="summary" className="text-lg font-semibold">
        Balance now
      </h2>
      <p className="text-3xl">
        <Amount minor={account.balance} currency={account.currency} />
      </p>
      <dl className="grid max-w-2xl grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <Row term="Code">
          <code className="font-mono">{account.code}</code>
        </Row>
        <Row term="Id">
          <CopyText value={account.id} label="account id" />
        </Row>
        <Row term="Currency">{account.currency}</Row>
        <Row term="Type">{TYPE_LABELS[account.type]}</Row>
        <Row term="Normal balance">{SIDE_LABELS[account.normal_balance]}</Row>
        <Row term="May go negative">{account.allow_negative ? 'Yes' : 'No'}</Row>
        <Row term="Created">
          <Time iso={account.created_at} />
        </Row>
        <Row term="Last posting">
          {account.last_posting_at === null ? 'None yet' : <Time iso={account.last_posting_at} />}
        </Row>
      </dl>
    </section>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-medium text-slate-700 dark:text-slate-300">{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The balance at a past moment: the moment typed, in the address, and the answer labelled. */
function AsOfPanel({ account }: { account: Account }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('as_of') ?? undefined;
  const parsed = requested === undefined ? undefined : parseAsOf(requested);
  const asOf = parsed?.ok ? parsed.iso : undefined;
  const balance = useBalanceAt(account.id, asOf);

  // What is wrong with the moment, from the address or from the server, instead of an answer.
  const serverError =
    balance.error instanceof ApiError ? balance.error.fieldErrors.as_of : undefined;
  const addressError = parsed && !parsed.ok ? AS_OF_RULE : undefined;

  const setAsOf = (iso: string | undefined): void => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (iso === undefined) next.delete('as_of');
      else next.set('as_of', iso);
      return next;
    });
  };

  return (
    <section aria-labelledby="asof" className="flex flex-col gap-3">
      <h2 id="asof" className="text-lg font-semibold">
        Balance at a past moment
      </h2>
      <AsOfControls
        requested={requested}
        externalError={addressError ?? serverError}
        onShow={setAsOf}
      />

      {asOf === undefined ? null : balance.data ? (
        <AsOfAnswer asked={asOf} answer={balance.data.data} account={account} />
      ) : balance.isError ? (
        serverError === undefined ? (
          <ApiErrorView
            error={balance.error}
            hideFieldErrors
            onRetry={() => {
              void balance.refetch();
            }}
          />
        ) : null
      ) : (
        <Loading what="the balance" />
      )}
    </section>
  );
}

function AsOfControls({
  requested,
  externalError,
  onShow,
}: {
  requested: string | undefined;
  externalError: string | undefined;
  onShow: (iso: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(requested ?? '');
  const [seen, setSeen] = useState(requested);
  const input = useRef<HTMLInputElement>(null);

  // The address is the source of truth: when it changes (back button, a link, "show"), the
  // field follows. (Adjusting state while rendering is the pattern React recommends for this.)
  if (seen !== requested) {
    setSeen(requested);
    setDraft(requested ?? '');
  }

  return (
    <form
      noValidate
      className="flex flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        // A moment that cannot be understood goes to the address as typed, and the panel
        // shows the error in place of any earlier answer, which would not match the field.
        const result = parseAsOf(draft);
        onShow(result.ok ? result.iso : draft.trim());
        if (!result.ok) input.current?.focus();
      }}
    >
      <Field
        label="As of (UTC)"
        hint="For example 2026-10-01 10:00, or 2026-10-01T10:00:00Z"
        error={externalError}
      >
        {(control) => (
          <Input
            {...control}
            ref={input}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            className="w-72 font-mono"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex items-end gap-2 self-end">
        <Button type="submit">Show balance</Button>
        <Button
          onClick={() => {
            onShow(undefined);
          }}
          disabled={requested === undefined}
        >
          Back to current balance
        </Button>
      </div>
    </form>
  );
}

function AsOfAnswer({
  asked,
  answer,
  account,
}: {
  asked: string;
  answer: Balance;
  account: Account;
}) {
  // ledgerd answers an instant in the future with the current balance and as_of null.
  const future = answer.as_of === null;
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-slate-400 p-4 dark:border-slate-500"
      aria-live="polite"
    >
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Balance as of <Time iso={asked} />
      </p>
      <p className="text-2xl">
        <Amount minor={answer.balance} currency={answer.currency} />
      </p>
      <p className="text-sm">
        {answer.last_posting_at === null ? (
          'There was no posting at or before that moment, so the balance was zero.'
        ) : (
          <>
            After the last posting at or before that moment, recorded at{' '}
            <Time iso={answer.last_posting_at} />.
          </>
        )}
      </p>
      {future ? (
        <p className="text-sm font-medium">
          That moment is in the future, so this is the current balance
          {account.last_posting_at === null ? '' : ' and it can still change'}.
        </p>
      ) : null}
    </div>
  );
}

function History({ account }: { account: Account }) {
  const postings = usePostings(account.id);
  const announce = useAnnounce();
  const loaded = postings.data?.pages.flatMap((page) => page.data.postings);
  const intermediate = intermediatePostingIds(loaded ?? []);

  return (
    <section aria-labelledby="history" className="flex flex-col gap-3">
      <h2 id="history" className="text-lg font-semibold">
        History
      </h2>
      <QueryView
        query={{
          data: loaded,
          error: postings.error,
          isError: postings.isError,
          isFetching: postings.isFetching && !postings.isFetchingNextPage,
          refetch: postings.refetch,
        }}
        what="the history"
      >
        {(items) =>
          items.length === 0 ? (
            <p>
              <strong>No postings yet.</strong> A posting is one line of a transaction. This account
              has not been part of one, so its balance has never changed.
            </p>
          ) : (
            <>
              <PostingsTable postings={items} intermediate={intermediate} />
              {intermediate.size > 0 ? (
                <p className="max-w-prose text-sm">
                  <strong>Intermediate</strong> marks a posting of a transaction that touches this
                  account more than once. The balance after it was only a step inside the
                  transaction, never a state anyone could see. The balance after the last posting of
                  the transaction is the committed one.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                {postings.hasNextPage ? (
                  <Button
                    onClick={() => {
                      void postings.fetchNextPage().then(() => {
                        announce('More postings loaded');
                      });
                    }}
                    loading={postings.isFetchingNextPage}
                  >
                    Load more postings
                  </Button>
                ) : null}
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {postings.hasNextPage
                    ? `${String(items.length)} postings loaded, more available`
                    : `All ${String(items.length)} ${items.length === 1 ? 'posting' : 'postings'} loaded`}
                </p>
              </div>
            </>
          )
        }
      </QueryView>
    </section>
  );
}

function PostingsTable({
  postings,
  intermediate,
}: {
  postings: Posting[];
  intermediate: ReadonlySet<number>;
}) {
  return (
    <Table caption="Postings, newest first" hideCaption>
      <thead>
        <tr>
          <Th>Recorded</Th>
          <Th>Transaction</Th>
          <Th>Direction</Th>
          <Th numeric>Amount</Th>
          <Th numeric>Balance after</Th>
        </tr>
      </thead>
      <tbody>
        {postings.map((posting) => (
          <tr key={posting.id}>
            <Td>
              <Time iso={posting.recorded_at} />
            </Td>
            <Td>
              <Link to={`/transactions/${posting.transaction_id}`} className="font-mono underline">
                <span aria-hidden="true">{posting.transaction_id.slice(0, 8)}…</span>
                <span className="sr-only">Transaction {posting.transaction_id}</span>
              </Link>
            </Td>
            <Td>{posting.direction === 'DEBIT' ? 'Debit' : 'Credit'}</Td>
            <Td numeric>
              <Amount minor={posting.amount} currency={posting.currency} />
            </Td>
            <Td numeric>
              <Amount minor={posting.balance_after} currency={posting.currency} />
              {intermediate.has(posting.id) ? (
                <span className="ml-2 rounded border border-amber-700 px-1 text-xs font-medium text-amber-900 dark:border-amber-300 dark:text-amber-100">
                  Intermediate
                </span>
              ) : null}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
