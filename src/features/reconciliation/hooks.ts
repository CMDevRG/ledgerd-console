import { useCallback, useEffect, useRef, useState } from 'react';

import { reconcile } from '../../api/endpoints';
import { useAnnounce } from '../../ui/LiveRegion';
import { reportStore, type ReportStore } from './store';

export type RunState =
  | { status: 'idle' }
  | { status: 'running'; deep: boolean; startedAt: number }
  | { status: 'failed'; deep: boolean; error: unknown }
  | { status: 'cancelled'; deep: boolean }
  /** The report that was just obtained, by its id in the store. */
  | { status: 'done'; deep: boolean; id: number };

/**
 * Runs a reconciliation, one at a time, and keeps its reports. While it runs there is no
 * report on offer: a previous one must not stand in for the answer being waited for (R10.5).
 */
export function useReconciliation(store: ReportStore = reportStore) {
  const announce = useAnnounce();
  const [state, setState] = useState<RunState>({ status: 'idle' });
  const controller = useRef<AbortController | null>(null);

  // Leaving the page cancels the request: nobody is waiting for it.
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const start = useCallback(
    async (deep: boolean): Promise<void> => {
      if (controller.current !== null) return;
      const abort = new AbortController();
      controller.current = abort;
      const startedAt = performance.now();
      setState({ status: 'running', deep, startedAt });
      try {
        const { data } = await reconcile(deep, abort.signal);
        const stored = store.add(data, Math.round(performance.now() - startedAt));
        setState({ status: 'done', deep, id: stored.id });
        announce(
          data.ok
            ? 'Reconciliation finished: nothing to report'
            : 'Reconciliation finished: problems found',
        );
      } catch (error) {
        if (abort.signal.aborted) {
          setState({ status: 'cancelled', deep });
          announce('Reconciliation cancelled');
        } else {
          setState({ status: 'failed', deep, error });
          announce('Reconciliation failed');
        }
      } finally {
        controller.current = null;
      }
    },
    [announce, store],
  );

  const cancel = useCallback((): void => {
    controller.current?.abort();
  }, []);

  return { state, start, cancel };
}

/** Seconds since `since` (a performance.now value), updated every second while `active`. */
export function useElapsedSeconds(active: boolean, since: number | undefined): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(performance.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return active && since !== undefined ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}
