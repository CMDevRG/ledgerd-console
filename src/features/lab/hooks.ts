import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { listAccounts } from '../../api/endpoints';
import { useAnnounce } from '../../ui/LiveRegion';
import { createIdSource, createLabApi } from './api';
import type { Scenario, ScenarioId, ScenarioResult } from './types';

/** Every Lab account's code starts with this. */
export const LAB_PREFIX = 'lab-';

const COUNT_PAGE = 200;
/** Counting stops here; the page then says "at least". */
const COUNT_CAP = 20_000;

/** How many Lab accounts the connected ledger has, counted through the account list. */
export function useLabAccountCount() {
  return useQuery({
    queryKey: ['labAccounts'],
    queryFn: async ({ signal }) => {
      let count = 0;
      let cursor: string | undefined;
      do {
        const { data } = await listAccounts(
          {
            limit: COUNT_PAGE,
            codePrefix: LAB_PREFIX,
            ...(cursor !== undefined ? { cursor } : {}),
          },
          signal,
        );
        count += data.accounts.length;
        cursor = data.next_cursor ?? undefined;
      } while (cursor !== undefined && count < COUNT_CAP);
      return { count, capped: cursor !== undefined };
    },
    retry: false,
  });
}

export type RunState =
  { status: 'idle' } | { status: 'running' } | { status: 'done'; result: ScenarioResult };

/**
 * Runs scenarios one at a time (they all write to the same ledger) and keeps the latest result
 * of each. When one finishes, the Lab account count and the account list are re-read.
 */
export function useScenarioRunner() {
  const client = useQueryClient();
  const announce = useAnnounce();
  const [states, setStates] = useState<Partial<Record<ScenarioId, RunState>>>({});
  const busy = useRef(false);
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (scenario: Scenario): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      setRunning(true);
      setStates((s) => ({ ...s, [scenario.id]: { status: 'running' } }));
      let result: ScenarioResult;
      try {
        result = await scenario.run(createLabApi(), createIdSource());
      } catch (error) {
        // A scenario handles its own failures; this is for a bug in one.
        result = {
          id: scenario.id,
          verdict: 'could-not-run',
          steps: [],
          error: error instanceof Error ? error.message : 'The scenario failed to run.',
        };
      }
      setStates((s) => ({ ...s, [scenario.id]: { status: 'done', result } }));
      busy.current = false;
      setRunning(false);
      announce(
        `${scenario.title}: ${
          result.verdict === 'as-designed'
            ? 'behaved as designed'
            : result.verdict === 'unexpected'
              ? 'UNEXPECTED result'
              : 'could not run'
        }`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['labAccounts'] }),
        client.invalidateQueries({ queryKey: ['accounts'] }),
      ]);
    },
    [announce, client],
  );

  return { states, running, run };
}
