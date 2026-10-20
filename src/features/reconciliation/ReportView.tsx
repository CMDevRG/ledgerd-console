import { Link } from 'react-router';

import type { ReconciliationReport } from '../../api/schemas';
import { Amount } from '../../ui/Amount';
import { Table, Td, Th } from '../../ui/Table';
import { Time } from '../../ui/Time';

interface ReportViewProps {
  report: ReconciliationReport;
  /** How long the request took, in milliseconds. */
  durationMs: number;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * One reconciliation report: the verdict first, said loudly when something is wrong, then the
 * numbers behind it. Each row that concerns an account links to it.
 */
export function ReportView({ report, durationMs }: ReportViewProps) {
  const problems =
    report.mismatches.length +
    report.chain_breaks.length +
    report.currencies.filter((c) => !c.balanced).length;

  return (
    <div className="flex flex-col gap-6">
      {report.ok ? (
        <p
          role="status"
          className="rounded-md border-2 border-green-800 bg-green-50 p-3 font-semibold text-green-950 dark:border-green-300 dark:bg-green-950 dark:text-green-50"
        >
          <span aria-hidden="true">✓ </span>Consistent: nothing to report
        </p>
      ) : (
        <div
          role="alert"
          className="rounded-md border-4 border-red-800 bg-red-50 p-4 text-red-950 dark:border-red-300 dark:bg-red-950 dark:text-red-50"
        >
          <p className="text-lg font-bold">
            <span aria-hidden="true">✗ </span>Problems found
          </p>
          <p>
            {problems} {problems === 1 ? 'thing does' : 'things do'} not add up. The tables below
            show where. Reconciliation only reports: it changes nothing.
          </p>
        </div>
      )}

      <dl className="grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] [&_dd]:[overflow-wrap:anywhere] gap-x-6 gap-y-1 text-sm">
        <dt className="font-medium text-slate-700 dark:text-slate-300">Kind</dt>
        <dd>{report.deep ? 'Deep' : 'Standard'}</dd>
        <dt className="font-medium text-slate-700 dark:text-slate-300">Started</dt>
        <dd>
          <Time iso={report.started_at} />
        </dd>
        <dt className="font-medium text-slate-700 dark:text-slate-300">Took</dt>
        <dd>{seconds(durationMs)}</dd>
        <dt className="font-medium text-slate-700 dark:text-slate-300">Accounts checked</dt>
        <dd>{report.accounts_checked}</dd>
      </dl>

      <section aria-labelledby="mismatches" className="flex flex-col gap-2">
        <h3 id="mismatches" className="font-semibold">
          Balance mismatches
        </h3>
        {report.mismatches.length === 0 ? (
          <p className="text-sm">
            <span aria-hidden="true">✓ </span>Every stored balance equals the sum of its postings.
          </p>
        ) : (
          <Table caption="Accounts whose stored balance differs from their postings" hideCaption>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th numeric>Stored</Th>
                <Th numeric>Expected from postings</Th>
                <Th numeric>Difference</Th>
              </tr>
            </thead>
            <tbody>
              {report.mismatches.map((m) => (
                <tr key={m.account_id}>
                  <Td>
                    <Link to={`/accounts/${m.account_id}`} className="font-mono underline">
                      {m.code}
                    </Link>
                  </Td>
                  <Td numeric>
                    <Amount minor={m.stored} currency={m.currency} />
                  </Td>
                  <Td numeric>
                    <Amount minor={m.expected} currency={m.currency} />
                  </Td>
                  <Td numeric>
                    <Amount minor={m.stored - m.expected} currency={m.currency} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="totals" className="flex flex-col gap-2">
        <h3 id="totals" className="font-semibold">
          Debits and credits per currency
        </h3>
        {report.currencies.length === 0 ? (
          <p className="text-sm">No postings yet, so there is nothing to add up.</p>
        ) : (
          <Table caption="Total debits and credits per currency" hideCaption>
            <thead>
              <tr>
                <Th>Currency</Th>
                <Th numeric>Debits</Th>
                <Th numeric>Credits</Th>
                <Th>Balanced?</Th>
              </tr>
            </thead>
            <tbody>
              {report.currencies.map((c) => (
                <tr key={c.currency}>
                  <Td>{c.currency}</Td>
                  <Td numeric>
                    <Amount minor={c.debits} currency={c.currency} />
                  </Td>
                  <Td numeric>
                    <Amount minor={c.credits} currency={c.currency} />
                  </Td>
                  <Td>
                    {c.balanced ? (
                      <>
                        <span aria-hidden="true">✓ </span>Balanced
                      </>
                    ) : (
                      <strong>
                        <span aria-hidden="true">✗ </span>Does not balance
                      </strong>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="chains" className="flex flex-col gap-2">
        <h3 id="chains" className="font-semibold">
          Balance chains
        </h3>
        {!report.deep ? (
          <p className="text-sm">
            Not checked in a standard run. Run a deep check to verify that each posting's balance
            follows from the one before it.
          </p>
        ) : report.chain_breaks.length === 0 ? (
          <p className="text-sm">
            <span aria-hidden="true">✓ </span>Every posting's balance follows from the previous one.
          </p>
        ) : (
          <Table caption="Postings whose balance does not follow from the previous one" hideCaption>
            <thead>
              <tr>
                <Th numeric>Posting</Th>
                <Th>Account</Th>
                <Th numeric>Recorded</Th>
                <Th numeric>Expected</Th>
              </tr>
            </thead>
            <tbody>
              {report.chain_breaks.map((b) => (
                <tr key={b.posting_id}>
                  <Td numeric>{b.posting_id}</Td>
                  <Td>
                    <Link to={`/accounts/${b.account_id}`} className="font-mono underline">
                      {b.account_id.slice(0, 8)}…
                    </Link>
                  </Td>
                  <Td numeric>{b.recorded.toString()}</Td>
                  <Td numeric>{b.expected.toString()}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
