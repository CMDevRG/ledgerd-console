import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getAccount, getBalance, listPostings } from '../../api/endpoints';

/** How often an open account page asks for the current balance. */
export const ACCOUNT_POLL_MS = 10_000;
export const POSTINGS_PAGE_SIZE = 50;

/** The account and its current balance, refreshed while the page is open. */
export function useAccount(id: string, enabled = true) {
  return useQuery({
    queryKey: ['account', id],
    queryFn: ({ signal }) => getAccount(id, signal),
    refetchInterval: ACCOUNT_POLL_MS,
    retry: false,
    enabled,
  });
}

/**
 * The balance at a past instant. The past does not change, so it is asked once and kept.
 * (An instant in the future gets the current balance back, which does change; the page says so.)
 */
export function useBalanceAt(id: string, asOf: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['balance', id, asOf],
    queryFn: ({ signal }) => getBalance(id, asOf, signal),
    enabled: enabled && asOf !== undefined,
    retry: false,
  });
}

/** The history, newest first, a page at a time; pages are appended as more are asked for. */
export function usePostings(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['postings', id],
    queryFn: ({ pageParam, signal }) =>
      listPostings(
        id,
        { limit: POSTINGS_PAGE_SIZE, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.data.next_cursor ?? undefined,
    enabled,
    retry: false,
  });
}

/**
 * Brings an open account page up to date after the console submits a transaction: the
 * account (balance), its history, and the list of accounts. Refetching an infinite query
 * re-reads the pages already loaded from the top, each page's cursor coming from the page
 * before it, so nothing is skipped or repeated.
 */
export async function refreshAfterTransaction(
  client: QueryClient,
  accountIds: readonly string[],
): Promise<void> {
  await Promise.all([
    ...accountIds.flatMap((id) => [
      client.invalidateQueries({ queryKey: ['account', id] }),
      client.invalidateQueries({ queryKey: ['postings', id] }),
    ]),
    client.invalidateQueries({ queryKey: ['accounts'] }),
  ]);
}

/**
 * Notices a posting made by someone else (the balance poll shows a newer `last_posting_at`)
 * and re-reads the history, so the page does not show a balance that its history cannot explain.
 */
export function useRefreshHistoryOnNewPosting(
  id: string,
  lastPostingAt: string | null | undefined,
): void {
  const client = useQueryClient();
  const known = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (lastPostingAt === undefined) return;
    const before = known.current;
    known.current = lastPostingAt;
    if (before !== undefined && before !== lastPostingAt) {
      void client.invalidateQueries({ queryKey: ['postings', id] });
    }
  }, [client, id, lastPostingAt]);
}
