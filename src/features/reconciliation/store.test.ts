import { describe, expect, it, vi } from 'vitest';

import type { ReconciliationReport } from '../../api/schemas';
import { createReportStore } from './store';

const report = (deep = false): ReconciliationReport => ({
  started_at: '2026-10-13T15:04:05.123456Z',
  deep,
  ok: true,
  accounts_checked: 1,
  mismatches: [],
  currencies: [],
  chain_breaks: [],
});

describe('the report store', () => {
  it('keeps reports in the order they arrived, numbered from 1', () => {
    const store = createReportStore();
    store.add(report(), 120, 1000);
    store.add(report(true), 340, 2000);
    expect(store.get().map((r) => [r.id, r.report.deep, r.durationMs, r.receivedAt])).toEqual([
      [1, false, 120, 1000],
      [2, true, 340, 2000],
    ]);
  });

  it('tells subscribers, and not after they unsubscribe', () => {
    const store = createReportStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.add(report(), 1);
    off();
    store.add(report(), 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('gives a new list each time, so a view of it notices the change', () => {
    const store = createReportStore();
    const before = store.get();
    store.add(report(), 1);
    expect(store.get()).not.toBe(before);
    expect(before).toHaveLength(0);
  });

  it('starts again from 1 after clearing', () => {
    const store = createReportStore();
    store.add(report(), 1);
    store.clear();
    expect(store.get()).toEqual([]);
    expect(store.add(report(), 1).id).toBe(1);
  });
});
