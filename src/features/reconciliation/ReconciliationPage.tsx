import { useState } from 'react';

import { PageHeading } from '../../app/PageHeading';
import { ApiErrorView } from '../../ui/ApiErrorView';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Field';
import { Table, Td, Th } from '../../ui/Table';
import { Time } from '../../ui/Time';
import { ComparisonView } from './ComparisonView';
import { useElapsedSeconds, useReconciliation } from './hooks';
import { ReportView } from './ReportView';
import { useReports, type StoredReport } from './store';

export default function ReconciliationPage() {
  const reports = useReports();
  const { state, start, cancel } = useReconciliation();
  const [deep, setDeep] = useState(false);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const running = state.status === 'running';
  const elapsed = useElapsedSeconds(
    running,
    state.status === 'running' ? state.startedAt : undefined,
  );

  // The report just obtained, if the last run succeeded. Nothing else counts as current.
  const currentId = state.status === 'done' ? state.id : undefined;
  const viewingId = selected ?? currentId;
  const viewing = reports.find((r) => r.id === viewingId);

  return (
    <>
      <PageHeading title="Reconciliation" />
      <div className="mb-6 flex max-w-prose flex-col gap-2 text-slate-700 dark:text-slate-300">
        <p>
          A reconciliation asks ledgerd to check itself. It adds up the postings of every account
          and compares the sum with the balance ledgerd stores, and it checks that, in each
          currency, total debits equal total credits.
        </p>
        <p>
          A <strong>deep</strong> check also follows each account's postings one by one and checks
          that every balance-after follows from the one before. It is thorough and can take minutes
          on a large ledger.
        </p>
        <p>
          It only <strong>reports</strong>. It never repairs anything, and it never changes a
          balance.
        </p>
      </div>

      <form
        className="mb-6 flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected(undefined);
          void start(deep);
        }}
      >
        <fieldset className="flex flex-col gap-1" disabled={running}>
          <legend className="mb-1 text-sm font-medium">Kind of check</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              checked={!deep}
              onChange={() => {
                setDeep(false);
              }}
            />
            Standard
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              checked={deep}
              onChange={() => {
                setDeep(true);
              }}
            />
            Deep
          </label>
        </fieldset>
        <Button type="submit" variant="primary" loading={running}>
          Run reconciliation
        </Button>
        {running ? <Button onClick={cancel}>Cancel</Button> : null}
      </form>

      {state.status === 'running' ? (
        <p role="status" className="mb-6 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
          />
          Running a {state.deep ? 'deep' : 'standard'} reconciliation… {elapsed} s. There is no
          percentage: ledgerd answers when it has finished.
        </p>
      ) : null}

      {state.status === 'failed' ? (
        <div className="mb-6 flex flex-col gap-2">
          <ApiErrorView
            error={state.error}
            onRetry={() => {
              setSelected(undefined);
              void start(state.deep);
            }}
          />
          <p className="text-sm">
            This run produced no report. Earlier reports, if any, are listed below and are not the
            result of this run.
          </p>
        </div>
      ) : null}

      {state.status === 'cancelled' ? (
        <p role="status" className="mb-6">
          The reconciliation was cancelled. It produced no report. ledgerd may have finished it
          anyway: it only reads, so nothing was changed.
        </p>
      ) : null}

      {viewing === undefined ? (
        state.status === 'running' ? null : (
          <p className="mb-6" data-testid="no-report">
            {state.status === 'idle' && reports.length === 0
              ? 'No report yet. Run a reconciliation to see one.'
              : 'There is no current report.'}
          </p>
        )
      ) : (
        <section aria-labelledby="report" className="mb-8 flex flex-col gap-3">
          <h2 id="report" className="text-lg font-semibold">
            Report {viewing.id}
          </h2>
          {viewing.id === currentId ? null : (
            <p
              role="note"
              className="rounded-md border-2 border-amber-700 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-50"
            >
              <span aria-hidden="true">! </span>This is an earlier report, started at{' '}
              <Time iso={viewing.report.started_at} />. It is not the result of the latest run, and
              the ledger may have changed since.
            </p>
          )}
          <ReportView report={viewing.report} durationMs={viewing.durationMs} />
        </section>
      )}

      {reports.length === 0 ? null : (
        <History reports={reports} viewingId={viewingId} onView={setSelected} />
      )}
    </>
  );
}

function History({
  reports,
  viewingId,
  onView,
}: {
  reports: readonly StoredReport[];
  viewingId: number | undefined;
  onView: (id: number) => void;
}) {
  const [aId, setAId] = useState<string>('');
  const [bId, setBId] = useState<string>('');
  const first = reports.find((r) => String(r.id) === aId);
  const second = reports.find((r) => String(r.id) === bId);
  const pair =
    first !== undefined && second !== undefined && first.id !== second.id
      ? first.id < second.id
        ? { earlier: first, later: second }
        : { earlier: second, later: first }
      : undefined;
  const sameChosen = first !== undefined && first.id === second?.id;

  return (
    <section aria-labelledby="history" className="flex flex-col gap-4">
      <h2 id="history" className="text-lg font-semibold">
        Reports of this session
      </h2>
      <p className="max-w-prose text-sm">
        They are kept only while this page is open in the browser. Reloading forgets them.
      </p>
      <Table caption="Reports of this session, newest first" hideCaption>
        <thead>
          <tr>
            <Th numeric>#</Th>
            <Th>Kind</Th>
            <Th>Started</Th>
            <Th numeric>Took</Th>
            <Th>Result</Th>
            <Th>
              <span className="sr-only">Show</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {[...reports].reverse().map((r) => (
            <tr key={r.id}>
              <Td numeric>{r.id}</Td>
              <Td>{r.report.deep ? 'Deep' : 'Standard'}</Td>
              <Td>
                <Time iso={r.report.started_at} />
              </Td>
              <Td numeric>{(r.durationMs / 1000).toFixed(1)} s</Td>
              <Td>{r.report.ok ? 'Consistent' : <strong>Problems found</strong>}</Td>
              <Td>
                <Button
                  aria-label={`Show report ${String(r.id)}`}
                  aria-pressed={viewingId === r.id}
                  onClick={() => {
                    onView(r.id);
                  }}
                >
                  {viewingId === r.id ? 'Showing' : 'Show'}
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {reports.length < 2 ? null : (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Compare two reports</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              First report
              <Select
                value={aId}
                onChange={(e) => {
                  setAId(e.target.value);
                }}
              >
                <option value="">Choose…</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    Report {r.id} ({r.report.deep ? 'deep' : 'standard'})
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Second report
              <Select
                value={bId}
                onChange={(e) => {
                  setBId(e.target.value);
                }}
              >
                <option value="">Choose…</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    Report {r.id} ({r.report.deep ? 'deep' : 'standard'})
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {sameChosen ? <p className="text-sm">Choose two different reports.</p> : null}
          {pair === undefined ? null : <ComparisonView earlier={pair.earlier} later={pair.later} />}
        </div>
      )}
    </section>
  );
}
