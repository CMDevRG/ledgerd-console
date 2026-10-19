import { Link } from 'react-router';

import { Amount } from '../../ui/Amount';
import { Table, Td, Th } from '../../ui/Table';
import { compareReports } from './compare';
import type { StoredReport } from './store';

const TREND = {
  better: 'Better: problems went away and none appeared.',
  worse: 'Worse: problems appeared and none went away.',
  mixed: 'Mixed: some problems went away and others appeared.',
  same: 'No difference in what was found.',
} as const;

/** What changed between two reports of the session. */
export function ComparisonView({ earlier, later }: { earlier: StoredReport; later: StoredReport }) {
  const c = compareReports(earlier.report, later.report);
  const m = c.mismatches;

  return (
    <section aria-labelledby="comparison" className="flex flex-col gap-3">
      <h3 id="comparison" className="font-semibold">
        Report {earlier.id} compared with report {later.id}
      </h3>
      <p className="font-medium">{TREND[c.trend]}</p>
      <ul className="list-disc pl-5 text-sm">
        <li>
          Accounts checked: {c.accountsChecked.before}, then {c.accountsChecked.after}.
        </li>
        <li>
          Balance mismatches: {m.appeared.length} new, {m.resolved.length} resolved,{' '}
          {m.changed.length} changed, {m.unchanged.length} the same.
        </li>
        {c.chainBreaks === undefined ? (
          <li>
            Balance chains: not compared, because only a deep run checks them and one of these two
            was a standard run.
          </li>
        ) : (
          <li>
            Balance chains: {c.chainBreaks.appeared.length} new, {c.chainBreaks.resolved.length}{' '}
            resolved, {c.chainBreaks.changed.length} changed, {c.chainBreaks.unchanged.length} the
            same.
          </li>
        )}
      </ul>

      {m.appeared.length + m.resolved.length + m.changed.length === 0 ? null : (
        <Table caption="Mismatches that differ between the two reports" hideCaption>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>What happened</Th>
              <Th numeric>Stored then</Th>
              <Th numeric>Stored now</Th>
            </tr>
          </thead>
          <tbody>
            {m.appeared.map((x) => (
              <tr key={`a-${x.account_id}`}>
                <Td>
                  <Link to={`/accounts/${x.account_id}`} className="font-mono underline">
                    {x.code}
                  </Link>
                </Td>
                <Td>New mismatch</Td>
                <Td numeric>—</Td>
                <Td numeric>
                  <Amount minor={x.stored} currency={x.currency} />
                </Td>
              </tr>
            ))}
            {m.resolved.map((x) => (
              <tr key={`r-${x.account_id}`}>
                <Td>
                  <Link to={`/accounts/${x.account_id}`} className="font-mono underline">
                    {x.code}
                  </Link>
                </Td>
                <Td>Resolved</Td>
                <Td numeric>
                  <Amount minor={x.stored} currency={x.currency} />
                </Td>
                <Td numeric>—</Td>
              </tr>
            ))}
            {m.changed.map(({ before, after }) => (
              <tr key={`c-${after.account_id}`}>
                <Td>
                  <Link to={`/accounts/${after.account_id}`} className="font-mono underline">
                    {after.code}
                  </Link>
                </Td>
                <Td>Changed</Td>
                <Td numeric>
                  <Amount minor={before.stored} currency={before.currency} />
                </Td>
                <Td numeric>
                  <Amount minor={after.stored} currency={after.currency} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {c.currencies.length === 0 ? (
        <p className="text-sm">Debit and credit totals per currency are the same in both.</p>
      ) : (
        <Table caption="Currencies whose totals differ between the two reports" hideCaption>
          <thead>
            <tr>
              <Th>Currency</Th>
              <Th numeric>Debits then</Th>
              <Th numeric>Debits now</Th>
              <Th numeric>Credits then</Th>
              <Th numeric>Credits now</Th>
              <Th>Balanced now?</Th>
            </tr>
          </thead>
          <tbody>
            {c.currencies.map((x) => (
              <tr key={x.currency}>
                <Td>{x.currency}</Td>
                <Td numeric>
                  {x.before ? <Amount minor={x.before.debits} currency={x.currency} /> : '—'}
                </Td>
                <Td numeric>
                  {x.after ? <Amount minor={x.after.debits} currency={x.currency} /> : '—'}
                </Td>
                <Td numeric>
                  {x.before ? <Amount minor={x.before.credits} currency={x.currency} /> : '—'}
                </Td>
                <Td numeric>
                  {x.after ? <Amount minor={x.after.credits} currency={x.currency} /> : '—'}
                </Td>
                <Td>{x.after === undefined ? '—' : x.after.balanced ? 'Yes' : 'No'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
