import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LiveRegionProvider } from '../../ui/LiveRegion';
import { useScenarioRunner } from './hooks';
import type { Scenario, ScenarioResult } from './types';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <LiveRegionProvider>{children}</LiveRegionProvider>
  </QueryClientProvider>
);

const result = (id: Scenario['id'], verdict: ScenarioResult['verdict']): ScenarioResult => ({
  id,
  verdict,
  steps: [],
});

function fake(id: Scenario['id'], run: Scenario['run']): Scenario {
  return { id, title: id, summary: '', run };
}

describe('useScenarioRunner', () => {
  it('runs only one scenario at a time: they all write to the same ledger', async () => {
    let release: (r: ScenarioResult) => void = () => undefined;
    const slow = vi.fn(
      () =>
        new Promise<ScenarioResult>((resolve) => {
          release = resolve;
        }),
    );
    const other = vi.fn(() => Promise.resolve(result('retry', 'as-designed')));
    const { result: hook } = renderHook(() => useScenarioRunner(), { wrapper });

    act(() => {
      void hook.current.run(fake('overdraft', slow));
    });
    expect(hook.current.running).toBe(true);
    expect(hook.current.states.overdraft?.status).toBe('running');

    await act(async () => {
      await hook.current.run(fake('retry', other)); // refused: another is running
      await hook.current.run(fake('overdraft', slow)); // and so is the same one again
    });
    expect(other).not.toHaveBeenCalled();
    expect(slow).toHaveBeenCalledTimes(1);

    act(() => {
      release(result('overdraft', 'as-designed'));
    });
    await waitFor(() => {
      expect(hook.current.running).toBe(false);
    });
    expect(hook.current.states.overdraft).toEqual({
      status: 'done',
      result: result('overdraft', 'as-designed'),
    });

    await act(async () => {
      await hook.current.run(fake('retry', other)); // free again
    });
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest result of each scenario', async () => {
    const { result: hook } = renderHook(() => useScenarioRunner(), { wrapper });
    await act(async () => {
      await hook.current.run(
        fake('overdraft', () => Promise.resolve(result('overdraft', 'unexpected'))),
      );
      await hook.current.run(fake('retry', () => Promise.resolve(result('retry', 'as-designed'))));
    });
    expect(hook.current.states.overdraft).toMatchObject({
      status: 'done',
      result: { verdict: 'unexpected' },
    });
    expect(hook.current.states.retry).toMatchObject({
      status: 'done',
      result: { verdict: 'as-designed' },
    });
  });

  it('turns a bug in a scenario into "could not run", never into a pass, and frees the runner', async () => {
    const { result: hook } = renderHook(() => useScenarioRunner(), { wrapper });
    await act(async () => {
      await hook.current.run(fake('overdraft', () => Promise.reject(new Error('scenario bug'))));
    });
    expect(hook.current.states.overdraft).toMatchObject({
      status: 'done',
      result: { verdict: 'could-not-run', error: 'scenario bug' },
    });
    expect(hook.current.running).toBe(false);
  });
});
