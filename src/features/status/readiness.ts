import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getReadiness } from '../../api/endpoints';
import { ApiError } from '../../api/problem';
import { useAnnounce } from '../../ui/LiveRegion';

/** How often the console asks ledgerd whether it is ready. */
export const READINESS_POLL_MS = 10_000;

/**
 * What the console knows about ledgerd right now:
 *
 * - `ready`: ledgerd answered that it is ready.
 * - `not_ready`: ledgerd answered, with a problem document, that it is not.
 * - `unreachable`: nothing answered (the console server or ledgerd is down, or too slow).
 * - `misconfigured`: ledgerd refused the console server's API key.
 * - `unexpected`: something answered, but not in the documented form, so it is not trusted.
 */
export type ReadinessState =
  'checking' | 'ready' | 'not_ready' | 'unreachable' | 'misconfigured' | 'unexpected';

export function classifyReadiness(query: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
}): ReadinessState {
  // An error wins over older data: one failed check means "not ready now".
  if (query.isError) {
    const error = query.error;
    if (!(error instanceof ApiError)) return 'unexpected';
    if (error.code === 'console_misconfigured') return 'misconfigured';
    if (error.kind === 'busy' || error.kind === 'refused') return 'not_ready';
    if (error.kind === 'network') return 'unreachable';
    return 'unexpected';
  }
  return query.isPending ? 'checking' : 'ready';
}

export interface ReadinessView {
  /** Short text for the badge. */
  label: string;
  /** A symbol that carries the meaning without colour (decorative to screen readers). */
  symbol: string;
  tone: string;
  /** What assistive technology is told when the state changes to this. */
  announcement: string;
}

const AMBER = 'bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-50';
const RED = 'bg-red-100 text-red-950 dark:bg-red-900 dark:text-red-50';

export const READINESS_VIEWS: Record<ReadinessState, ReadinessView> = {
  checking: {
    label: 'Checking API…',
    symbol: '…',
    tone: 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-50',
    announcement: 'Checking whether ledgerd is ready',
  },
  ready: {
    label: 'API ready',
    symbol: '✓',
    tone: 'bg-green-100 text-green-950 dark:bg-green-900 dark:text-green-50',
    announcement: 'ledgerd is ready',
  },
  not_ready: {
    label: 'API not ready',
    symbol: '!',
    tone: AMBER,
    announcement: 'ledgerd is not ready',
  },
  unreachable: {
    label: 'Cannot reach the API',
    symbol: '✕',
    tone: RED,
    announcement: 'Cannot reach ledgerd',
  },
  misconfigured: {
    label: 'Console key rejected',
    symbol: '✕',
    tone: RED,
    announcement: 'ledgerd refused the console key; the console is not authorised',
  },
  unexpected: {
    label: 'Unexpected answer from the API',
    symbol: '!',
    tone: AMBER,
    announcement: 'ledgerd gave an answer the console does not understand',
  },
};

/** Polls ledgerd's readiness through the console server. */
export function useReadiness() {
  return useQuery({
    queryKey: ['readiness'],
    queryFn: ({ signal }) => getReadiness(signal),
    refetchInterval: READINESS_POLL_MS,
    retry: false,
  });
}

export function useReadinessState() {
  const query = useReadiness();
  return { query, state: classifyReadiness(query) };
}

/**
 * Tells assistive technology when readiness changes, without moving focus (R1.4). The first
 * answer is announced only if it is bad: "ready" on every page load would be noise, but an
 * outage found at load is news.
 */
export function useAnnounceReadinessChanges(state: ReadinessState): void {
  const announce = useAnnounce();
  const previous = useRef<ReadinessState | undefined>(undefined);

  useEffect(() => {
    if (state === 'checking') return;
    const before = previous.current;
    previous.current = state;
    const changed = before === undefined ? state !== 'ready' : before !== state;
    if (changed) announce(READINESS_VIEWS[state].announcement);
  }, [state, announce]);
}
