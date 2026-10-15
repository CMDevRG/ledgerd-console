import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageHeading } from '../../app/PageHeading';
import type { Account } from '../../api/schemas';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Field';
import { useAnnounce } from '../../ui/LiveRegion';
import { QueryView } from '../../ui/QueryView';
import { AccountForm } from './AccountForm';
import { AccountsTable } from './AccountsTable';
import { useAccountsList } from './hooks';
import {
  filtersFromParams,
  matchesFilters,
  paramsFromFilters,
  validateFilters,
  type AccountFilters,
} from './rules';

export default function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const filterErrors = validateFilters(filters);
  const valid = Object.keys(filterErrors).length === 0;
  const filtered = filters.code !== '' || filters.currency !== '';

  const list = useAccountsList(filters, valid);
  const announce = useAnnounce();
  const [created, setCreated] = useState<Account | undefined>(undefined);
  const [focusRequest, setFocusRequest] = useState(0);

  const accounts = list.data?.pages.flatMap((page) => page.data.accounts);
  const loadedPages = list.data?.pages.length ?? 0;

  // Say how many more arrived when "load more" is used (not for the first page).
  const lastCount = useRef(0);
  useEffect(() => {
    const total = accounts?.length ?? 0;
    if (loadedPages > 1 && total > lastCount.current) {
      announce(
        `${String(total - lastCount.current)} more accounts loaded, ${String(total)} in all`,
      );
    }
    lastCount.current = total;
  }, [accounts?.length, loadedPages, announce]);

  const apply = (next: AccountFilters): void => {
    setParams(paramsFromFilters(next));
  };

  return (
    <>
      <PageHeading title="Accounts" />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <FilterForm
            key={params.toString()}
            filters={filters}
            errors={filterErrors}
            onApply={apply}
          />

          {created === undefined ? null : (
            <CreatedNotice
              account={created}
              hidden={!matchesFilters(created, filters)}
              onClearFilters={() => {
                apply({ code: '', currency: '' });
              }}
            />
          )}

          {!valid ? (
            <p>Fix the filters above to see the accounts.</p>
          ) : (
            <QueryView
              query={{
                data: accounts,
                error: list.error,
                isError: list.isError,
                isFetching: list.isFetching && !list.isFetchingNextPage,
                refetch: list.refetch,
              }}
              what="accounts"
            >
              {(items) =>
                items.length === 0 ? (
                  <EmptyState
                    filtered={filtered}
                    onClear={() => {
                      apply({ code: '', currency: '' });
                    }}
                    onCreate={() => {
                      setFocusRequest((n) => n + 1);
                    }}
                  />
                ) : (
                  <>
                    <AccountsTable accounts={items} />
                    <div className="flex flex-wrap items-center gap-3">
                      {list.hasNextPage ? (
                        <Button
                          onClick={() => {
                            void list.fetchNextPage();
                          }}
                          loading={list.isFetchingNextPage}
                        >
                          Load more accounts
                        </Button>
                      ) : null}
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        {list.hasNextPage
                          ? `${String(items.length)} accounts loaded, more available`
                          : `All ${String(items.length)} ${items.length === 1 ? 'account' : 'accounts'} loaded`}
                      </p>
                    </div>
                  </>
                )
              }
            </QueryView>
          )}
        </div>

        <aside aria-label="Create an account" className="min-w-0">
          <AccountForm onCreated={setCreated} focusRequest={focusRequest} />
        </aside>
      </div>
    </>
  );
}

function FilterForm({
  filters,
  errors,
  onApply,
}: {
  filters: AccountFilters;
  errors: ReturnType<typeof validateFilters>;
  onApply: (filters: AccountFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  return (
    <form
      role="search"
      aria-label="Filter accounts"
      noValidate
      className="flex flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({ code: draft.code.trim(), currency: draft.currency.trim() });
      }}
    >
      <Field label="Code starts with" error={errors.code}>
        {(control) => (
          <Input
            {...control}
            value={draft.code}
            autoComplete="off"
            spellCheck={false}
            className="w-52 font-mono"
            onChange={(event) => {
              setDraft({ ...draft, code: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label="Currency" error={errors.currency}>
        {(control) => (
          <Input
            {...control}
            value={draft.currency}
            autoComplete="off"
            spellCheck={false}
            className="w-32 font-mono"
            onChange={(event) => {
              setDraft({ ...draft, currency: event.target.value.toUpperCase() });
            }}
          />
        )}
      </Field>
      <div className="flex items-end gap-2 self-end">
        <Button type="submit">Filter</Button>
        <Button
          onClick={() => {
            onApply({ code: '', currency: '' });
          }}
          disabled={
            filters.code === '' &&
            filters.currency === '' &&
            draft.code === '' &&
            draft.currency === ''
          }
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

function CreatedNotice({
  account,
  hidden,
  onClearFilters,
}: {
  account: Account;
  hidden: boolean;
  onClearFilters: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-green-800 bg-green-50 p-3 text-sm text-green-950 dark:border-green-300 dark:bg-green-950 dark:text-green-50">
      <p>
        <span aria-hidden="true">✓ </span>
        Account <code className="font-mono">{account.code}</code> was created.{' '}
        <Link to={`/accounts/${account.id}`} className="font-medium underline">
          Open {account.code}
        </Link>
      </p>
      {hidden ? (
        <p>
          It is not in the list below because of the current filters.{' '}
          <button type="button" className="font-medium underline" onClick={onClearFilters}>
            Clear the filters
          </button>
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({
  filtered,
  onClear,
  onCreate,
}: {
  filtered: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  return filtered ? (
    <div className="flex flex-col items-start gap-2">
      <p className="font-semibold">No account matches these filters</p>
      <Button onClick={onClear}>Clear the filters</Button>
    </div>
  ) : (
    <div className="flex max-w-prose flex-col items-start gap-2">
      <p className="font-semibold">There are no accounts yet</p>
      <p>
        An account is a named place where money of one currency is kept. Money moves between
        accounts in transactions, and every transaction must balance. Create an account to start.
      </p>
      <Button variant="primary" onClick={onCreate}>
        Create the first account
      </Button>
    </div>
  );
}
