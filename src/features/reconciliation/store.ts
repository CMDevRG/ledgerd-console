import { useSyncExternalStore } from 'react';

import type { ReconciliationReport } from '../../api/schemas';

/** A report kept for the session, with how it was obtained. */
export interface StoredReport {
  /** 1, 2, 3... in the order they arrived. */
  id: number;
  report: ReconciliationReport;
  /** How long the request took, as the page measured it. */
  durationMs: number;
  /** When the answer arrived (Date.now). */
  receivedAt: number;
}

export interface ReportStore {
  get: () => readonly StoredReport[];
  add: (report: ReconciliationReport, durationMs: number, receivedAt?: number) => StoredReport;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
}

/** The reports of this session. They live in memory only: a reload starts afresh. */
export function createReportStore(): ReportStore {
  let reports: readonly StoredReport[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    get: () => reports,
    add(report, durationMs, receivedAt = Date.now()) {
      const stored: StoredReport = { id: next, report, durationMs, receivedAt };
      next += 1;
      reports = [...reports, stored];
      notify();
      return stored;
    },
    clear() {
      reports = [];
      next = 1;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The store the application uses (kept while the user moves between pages). */
export const reportStore: ReportStore = createReportStore();

export function useReports(store: ReportStore = reportStore): readonly StoredReport[] {
  return useSyncExternalStore(store.subscribe, store.get);
}
