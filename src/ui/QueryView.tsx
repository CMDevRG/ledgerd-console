import type { ReactNode } from 'react';

import { ApiErrorView } from './ApiErrorView';
import { Loading, Refreshing } from './Status';

/** The parts of a TanStack Query result that decide what to show. */
interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

interface QueryViewProps<T> {
  query: QueryLike<T>;
  /** What is being loaded, for the messages ("accounts"). */
  what: string;
  children: (data: T) => ReactNode;
}

/**
 * Shows loaded data, or what stands in its place:
 *
 * - nothing yet: a loading message;
 * - failed, with nothing to show: the explanation and a retry (never an empty view that
 *   looks like "no data", R1.5);
 * - failed to refresh, with older data: the older data stays, with the explanation above it;
 * - refreshing in the background: the data stays, marked as refreshing (R12.4).
 */
export function QueryView<T>({ query, what, children }: QueryViewProps<T>) {
  const retry = (): void => {
    void query.refetch();
  };

  if (query.data === undefined) {
    return query.isError ? (
      <ApiErrorView error={query.error} onRetry={retry} />
    ) : (
      <Loading what={what} />
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-busy={query.isFetching}>
      {query.isError ? (
        <>
          <ApiErrorView error={query.error} onRetry={retry} />
          <p className="text-sm">Showing the {what} loaded earlier, which may be out of date.</p>
        </>
      ) : (
        <div className="flex justify-end">
          <Refreshing active={query.isFetching} />
        </div>
      )}
      {children(query.data)}
    </div>
  );
}
