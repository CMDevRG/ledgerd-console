import {
  memo,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { Link } from 'react-router';

import type { CreateTransactionBody } from '../../api/endpoints';
import { ApiError } from '../../api/problem';
import type { Transaction } from '../../api/schemas';
import { PageHeading } from '../../app/PageHeading';
import { resolveScale } from '../../money';
import { ApiErrorView } from '../../ui/ApiErrorView';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { ErrorSummary, type SummaryItem } from '../../ui/ErrorSummary';
import { Field, Input, Select } from '../../ui/Field';
import { useAnnounce } from '../../ui/LiveRegion';
import { Table, Td, Th } from '../../ui/Table';
import { useSettings } from '../settings/SettingsProvider';
import { validateFilters } from '../accounts/rules';
import { AccountSelect } from './AccountSelect';
import {
  initialState,
  MAX_ROWS,
  MIN_ROWS,
  reducer,
  verdict,
  type AccountRef,
  type Action,
  type BuilderState,
  type Row,
} from './builder';
import { useAccountOptions, useSubmitTransaction } from './hooks';
import { newIdempotencyKey } from './key';
import {
  buildRequest,
  clearErrorsFor,
  hasErrors,
  placeServerErrors,
  type BuildErrors,
  type RowErrors,
} from './request';
import { ResultView } from './ResultView';
import { TotalsPanel } from './TotalsPanel';

const NO_ERRORS: BuildErrors = { rows: {}, general: [] };
const NO_ROW_ERRORS: RowErrors = {};

interface Posted {
  transaction: Transaction;
  accounts: AccountRef[];
}

export default function BuilderPage() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(newIdempotencyKey()));
  const [settings] = useSettings();
  const announce = useAnnounce();
  const submission = useSubmitTransaction();
  const formRef = useRef<HTMLFormElement>(null);

  const [prefix, setPrefix] = useState('');
  const options = useAccountOptions(prefix);
  const prefixError = validateFilters({ code: prefix, currency: '' }).code;

  const [errors, setErrors] = useState<BuildErrors>(NO_ERRORS);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [otherError, setOtherError] = useState<unknown>(undefined);
  const [failedSubmits, setFailedSubmits] = useState(0);
  const [unbalancedBody, setUnbalancedBody] = useState<CreateTransactionBody | undefined>(
    undefined,
  );
  const [posted, setPosted] = useState<Posted | undefined>(undefined);

  // A change in whether the transaction balances is announced, not each keystroke.
  const status = verdict(state, settings);
  const lastStatus = useRef(status);
  useEffect(() => {
    if (status !== lastStatus.current && status !== 'incomplete') {
      announce(
        status === 'balanced' ? 'The transaction now balances' : 'The transaction does not balance',
      );
    }
    lastStatus.current = status;
  }, [status, announce]);

  /** Applies a change and drops the errors about what it changed (they describe the old value). */
  const edit = useCallback((action: Action): void => {
    dispatch(action);
    setOtherError(undefined);
    setErrors((e) => clearErrorsFor(e, action));
  }, []);

  const refuse = (found: BuildErrors, rest: string[] = []): void => {
    setErrors(found);
    setUnplaced(rest);
    setFailedSubmits((n) => n + 1);
  };

  const send = (body: CreateTransactionBody): void => {
    const sent = state; // the form as it was when sent; the person may edit while it is in flight
    setUnbalancedBody(undefined);
    setOtherError(undefined);
    submission.mutate(
      { body, key: sent.key },
      {
        onSuccess: ({ data }) => {
          const accounts = sent.rows.flatMap((r) => (r.account ? [r.account] : []));
          setPosted({ transaction: data, accounts });
          dispatch({ type: 'reset', key: newIdempotencyKey() });
          setErrors(NO_ERRORS);
          setUnplaced([]);
          announce('Transaction posted');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.kind === 'refused') {
            const placed = placeServerErrors(error.fieldErrors, sent);
            setOtherError(error); // code, title, detail and request id
            if (hasErrors(placed.errors) || placed.unplaced.length > 0) {
              refuse(placed.errors, placed.unplaced);
            }
            return;
          }
          setOtherError(error);
        },
      },
    );
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const built = buildRequest(state, settings);
    if (!built.ok) {
      setOtherError(undefined);
      refuse(built.errors);
      return;
    }
    setUnplaced([]);
    // Unbalanced transactions may be sent, to see the refusal, but not by accident.
    if (verdict(state, settings) === 'unbalanced') setUnbalancedBody(built.body);
    else send(built.body);
  };

  const summary = summaryItems(state, errors);
  const focusField = (key: string): void => {
    formRef.current?.querySelector<HTMLElement>(`[data-field="${key}"]`)?.focus();
  };
  const atMax = state.rows.length >= MAX_ROWS;
  const atMin = state.rows.length <= MIN_ROWS;

  return (
    <>
      <PageHeading title="New transaction" />
      <p className="mb-6 max-w-prose text-slate-700 dark:text-slate-300">
        A transaction moves money between accounts as postings: debits and credits. In every
        currency the debits must equal the credits, or ledgerd refuses it.
      </p>

      {posted === undefined ? null : (
        <div className="mb-6">
          <ResultView
            transaction={posted.transaction}
            accounts={posted.accounts}
            onDismiss={() => {
              setPosted(undefined);
            }}
          />
        </div>
      )}

      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-6">
        {summary.length > 0 ? (
          <ErrorSummary items={summary} focusKey={failedSubmits} onSelect={focusField} />
        ) : null}
        {unplaced.length > 0 ? (
          <ul className="list-disc pl-5 text-sm text-red-800 dark:text-red-300">
            {unplaced.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {otherError === undefined ? null : <ApiErrorView error={otherError} hideFieldErrors />}

        <Field label="Description" hint="Optional, up to 500 characters" error={errors.description}>
          {(control) => (
            <Input
              {...control}
              data-field="description"
              value={state.description}
              onChange={(event) => {
                edit({ type: 'setDescription', text: event.target.value });
              }}
            />
          )}
        </Field>

        <AccountsNotice options={options} />

        <section aria-labelledby="postings" className="flex flex-col gap-3">
          <h2 id="postings" className="text-lg font-semibold">
            Postings
          </h2>
          <Field
            label="Show accounts whose code starts with"
            hint="Optional: narrows the lists below"
            error={prefixError}
            className="max-w-sm"
          >
            {(control) => (
              <Input
                {...control}
                value={prefix}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                onChange={(event) => {
                  setPrefix(event.target.value.trim());
                }}
              />
            )}
          </Field>

          {errors.general.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-red-800 dark:text-red-300">
              {errors.general.map((line) => (
                <li key={line}>
                  <span className="font-semibold">Error:</span> {line}
                </li>
              ))}
            </ul>
          ) : null}

          <Table caption="Postings of the transaction" hideCaption>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Account</Th>
                <Th>Direction</Th>
                <Th>Amount</Th>
                <Th>Currency</Th>
                <Th>
                  <span className="sr-only">Remove</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row, index) => (
                <PostingRow
                  key={row.id}
                  row={row}
                  n={index + 1}
                  problems={errors.rows[row.id] ?? NO_ROW_ERRORS}
                  accounts={options.accounts}
                  loading={options.loading}
                  scale={
                    row.account ? resolveScale(row.account.currency, settings.scales) : undefined
                  }
                  canRemove={!atMin}
                  edit={edit}
                />
              ))}
            </tbody>
          </Table>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={atMax}
              onClick={() => {
                edit({ type: 'addRow' });
              }}
            >
              Add posting
            </Button>
            <Button
              onClick={() => {
                edit({ type: 'simpleTransfer' });
              }}
            >
              Simple transfer
            </Button>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {atMax
                ? `The most a transaction can have is ${String(MAX_ROWS)} postings.`
                : 'Simple transfer keeps one debit and one credit of the same amount.'}
            </p>
          </div>
        </section>

        <TotalsPanel state={state} settings={settings} />

        <div>
          <Button type="submit" variant="primary" loading={submission.isPending}>
            Send transaction
          </Button>
        </div>
      </form>

      <Dialog
        open={unbalancedBody !== undefined}
        title="This transaction does not balance"
        onClose={() => {
          setUnbalancedBody(undefined);
        }}
      >
        <p className="mb-4 text-sm">
          In at least one currency the debits and credits differ. ledgerd will refuse it, and
          nothing will be recorded. Send it anyway to see the refusal?
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setUnbalancedBody(undefined);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (unbalancedBody) send(unbalancedBody);
            }}
          >
            Send anyway
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function AccountsNotice({ options }: { options: ReturnType<typeof useAccountOptions> }) {
  if (options.query.isError) {
    return (
      <ApiErrorView
        error={options.query.error}
        onRetry={() => {
          void options.query.refetch();
        }}
      />
    );
  }
  if (
    !options.loading &&
    options.validPrefix &&
    options.accounts.length === 0 &&
    options.query.isSuccess
  ) {
    return (
      <p>
        There are no accounts to use yet.{' '}
        <Link to="/accounts" className="underline">
          Create accounts first
        </Link>
        .
      </p>
    );
  }
  if (options.truncated) {
    return (
      <p className="text-sm">
        Only the first {options.accounts.length} accounts are listed. Type the start of a code below
        to narrow the lists.
      </p>
    );
  }
  return null;
}

/** The errors as the summary lists them: one line per field, in the order of the form. */
function summaryItems(state: BuilderState, errors: BuildErrors): SummaryItem[] {
  const items: SummaryItem[] = [];
  if (errors.description !== undefined) {
    items.push({ key: 'description', label: 'Description', message: errors.description });
  }
  errors.general.forEach((message, i) => {
    items.push({ key: `general-${String(i)}`, label: 'Postings', message });
  });
  state.rows.forEach((row, index) => {
    const problems = errors.rows[row.id];
    if (problems === undefined) return;
    const n = String(index + 1);
    const base = `row-${String(row.id)}`;
    if (problems.account !== undefined)
      items.push({
        key: `${base}-account`,
        label: `Posting ${n} account`,
        message: problems.account,
      });
    if (problems.direction !== undefined)
      items.push({
        key: `${base}-direction`,
        label: `Posting ${n} direction`,
        message: problems.direction,
      });
    if (problems.amount !== undefined)
      items.push({ key: `${base}-amount`, label: `Posting ${n} amount`, message: problems.amount });
  });
  return items;
}

interface PostingRowProps {
  row: Row;
  /** Position in the form, from 1. */
  n: number;
  problems: RowErrors;
  accounts: readonly AccountRef[];
  loading: boolean;
  scale: number | undefined;
  canRemove: boolean;
  edit: (action: Action) => void;
}

/**
 * One posting. It only draws again when something about it changed, so typing in one amount
 * does not redraw the other ninety-nine rows of a large transaction.
 */
const PostingRow = memo(function PostingRow({
  row,
  n,
  problems,
  accounts,
  loading,
  scale,
  canRemove,
  edit,
}: PostingRowProps) {
  const field = (name: string): string => `row-${String(row.id)}-${name}`;
  return (
    <tr>
      <Td>{n}</Td>
      <Td>
        <Field
          label={<span className="sr-only">Account for posting {n}</span>}
          error={problems.account}
        >
          {(control) => (
            <AccountSelect
              {...control}
              data-field={field('account')}
              accounts={accounts}
              value={row.account}
              loading={loading}
              className="min-w-48"
              onAccountChange={(account) => {
                edit({ type: 'setAccount', id: row.id, account });
              }}
            />
          )}
        </Field>
      </Td>
      <Td>
        <Field
          label={<span className="sr-only">Direction of posting {n}</span>}
          error={problems.direction}
        >
          {(control) => (
            <Select
              {...control}
              data-field={field('direction')}
              value={row.direction}
              onChange={(event) => {
                edit({
                  type: 'setDirection',
                  id: row.id,
                  direction: event.target.value === 'CREDIT' ? 'CREDIT' : 'DEBIT',
                });
              }}
            >
              <option value="DEBIT">Debit</option>
              <option value="CREDIT">Credit</option>
            </Select>
          )}
        </Field>
      </Td>
      <Td>
        <Field
          label={<span className="sr-only">Amount of posting {n}</span>}
          error={problems.amount}
        >
          {(control) => (
            <Input
              {...control}
              data-field={field('amount')}
              value={row.amountText}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              className="w-40 font-mono"
              onChange={(event) => {
                edit({ type: 'setAmount', id: row.id, text: event.target.value });
              }}
            />
          )}
        </Field>
      </Td>
      <Td>
        {row.account === undefined || scale === undefined ? (
          <span className="text-slate-700 dark:text-slate-300">From the account</span>
        ) : (
          <>
            {row.account.currency}
            <span className="block text-xs text-slate-700 dark:text-slate-300">
              {scale} decimal {scale === 1 ? 'place' : 'places'}
            </span>
          </>
        )}
      </Td>
      <Td>
        <Button
          aria-label={`Remove posting ${String(n)}`}
          disabled={!canRemove}
          onClick={() => {
            edit({ type: 'removeRow', id: row.id });
          }}
        >
          Remove
        </Button>
      </Td>
    </tr>
  );
});
