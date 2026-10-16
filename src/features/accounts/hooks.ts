import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { createAccount, listAccounts } from '../../api/endpoints';
import type { AccountFilters } from './rules';

export const PAGE_SIZE = 50;

/**
 * The accounts, newest first, one page at a time. Pages are added to the end as more are
 * asked for; the ones already loaded are kept. The filters are ledgerd's own (a code prefix and
 * a currency), so they apply to every account and not only to the ones loaded so far.
 */
export function useAccountsList(filters: AccountFilters, enabled: boolean, pageSize = PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: ['accounts', filters, pageSize],
    queryFn: ({ pageParam, signal }) =>
      listAccounts(
        {
          limit: pageSize,
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          ...(filters.code !== '' ? { codePrefix: filters.code } : {}),
          ...(filters.currency !== '' ? { currency: filters.currency } : {}),
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.data.next_cursor ?? undefined,
    enabled,
    retry: false,
  });
}

export function useCreateAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof createAccount>[0]) => createAccount(body),
    onSuccess: async () => {
      // The new account is the newest, so it belongs at the top of every list it matches.
      await client.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
