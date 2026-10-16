import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { createTransaction, type CreateTransactionBody } from '../../api/endpoints';
import { refreshAfterTransaction } from '../accounts/detailHooks';
import { useAccountsList } from '../accounts/hooks';
import { ACCOUNT_CODE_PATTERN } from '../accounts/rules';
import type { AccountRef } from './builder';

/** Accounts offered in the pickers: read in pages of 200 until this many are loaded. */
export const ACCOUNT_OPTIONS_CAP = 1000;
const PICKER_PAGE_SIZE = 200;

/**
 * The accounts a posting can use, optionally only those whose code starts with `prefix`.
 * The pages are read one after the other until all are loaded (or the cap is reached), so a
 * picker is a plain list; `truncated` says there were more than the cap.
 */
export function useAccountOptions(prefix: string) {
  const validPrefix = prefix === '' || ACCOUNT_CODE_PATTERN.test(prefix);
  const query = useAccountsList({ code: prefix, currency: '' }, validPrefix, PICKER_PAGE_SIZE);
  // The same array until the data changes, so rows that receive it need not draw again.
  const pages = query.data?.pages;
  const accounts: AccountRef[] = useMemo(
    () =>
      pages
        ?.flatMap((page) => page.data.accounts)
        .map(({ id, code, currency }) => ({ id, code, currency })) ?? [],
    [pages],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = query;
  const room = accounts.length < ACCOUNT_OPTIONS_CAP;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError && room) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, room, fetchNextPage]);

  return {
    accounts,
    validPrefix,
    query,
    loading: validPrefix && (query.isPending || (hasNextPage && room && !isError)),
    truncated: hasNextPage && !room,
  };
}

/** Sends a transaction, then brings the pages of the accounts it touched up to date. */
export function useSubmitTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateTransactionBody; key: string }) =>
      createTransaction(body, key),
    onSuccess: async (_result, { body }) => {
      await refreshAfterTransaction(
        client,
        body.postings.map((p) => p.account_id),
      );
    },
  });
}
