import { PageHeading } from '../../app/PageHeading';
import { Table, Td, Th } from '../../ui/Table';
import { Time } from '../../ui/Time';
import benchmarkJson from '../../../data/benchmark.json';
import { describeChart, groupByVirtualUsers, hotShareOfSpread, rounded } from './derive';
import { benchmarkSchema, type Benchmark } from './schema';
import { SvgBarChart } from './SvgBarChart';

const LEDGERD_REPOSITORY = 'https://github.com/CMDevRG/ledgerd';

/** The page with the data file shipped in this repository. */
export default function BenchmarkPage() {
  return <BenchmarkContent raw={benchmarkJson} />;
}

/**
 * The page for any raw data. The file is checked here as well as at build time, so an invalid
 * one shows a plain message instead of numbers nobody can trust.
 */
export function BenchmarkContent({ raw }: { raw: unknown }) {
  const parsed = benchmarkSchema.safeParse(raw);
  return (
    <>
      <PageHeading title="Benchmark" />
      {parsed.success ? (
        <Results data={parsed.data} />
      ) : (
        <div
          role="alert"
          className="max-w-prose rounded-md border-2 border-red-800 bg-red-50 p-4 text-red-950 dark:border-red-300 dark:bg-red-950 dark:text-red-50"
        >
          <p className="font-semibold">The benchmark data cannot be shown</p>
          <p>
            The data file is not valid, so the numbers are not displayed rather than risk showing
            wrong ones. {parsed.error.issues.length} problem
            {parsed.error.issues.length === 1 ? '' : 's'} found; the build check lists them.
          </p>
        </div>
      )}
    </>
  );
}

const ms = (value: number | null): string =>
  value === null ? 'not recorded' : `${rounded(value)} ms`;

function Results({ data }: { data: Benchmark }) {
  const throughput = groupByVirtualUsers(data.runs, (r) => r.transfersPerSecond);
  const p95 = groupByVirtualUsers(data.runs, (r) => r.p95);
  const categories = throughput.virtualUsers.map((n) => `${String(n)} virtual users`);
  const share = hotShareOfSpread(data.runs);
  const top = share.at(-1);
  const { environment: env, source } = data;

  return (
    <div className="flex flex-col gap-8">
      <div
        role="note"
        className="max-w-prose rounded-md border-2 border-amber-700 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-50"
      >
        <p className="font-semibold">
          <span aria-hidden="true">! </span>One machine, not a promise
        </p>
        <p>
          These numbers were measured once, on one laptop, under the conditions listed below. They
          are not guarantees or capacity claims, and another machine will give other numbers. Run{' '}
          <code className="font-mono">make bench</code> in the ledgerd repository to measure your
          own.
        </p>
      </div>

      <section aria-labelledby="what" className="flex max-w-prose flex-col gap-2">
        <h2 id="what" className="text-lg font-semibold">
          What was measured
        </h2>
        <p>
          A <strong>transfer</strong> is one transaction with two postings, an idempotency key and
          the full checks: validation, locking, overdraft rules and the commit. It is the same code
          path as ordinary traffic. Each scenario ran {source.secondsPerScenario} seconds with a
          number of virtual users sending transfers as fast as they could.
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>Spread</strong>: transfers between many separate pairs of accounts. Writers
            rarely need the same account, so they mostly do not wait for one another. This is the
            best case.
          </li>
          <li>
            <strong>Hot account</strong>: every transfer credits the same account. A ledger must
            apply the changes to one account one after another, so all the writers queue for it.
            This is the worst case, and it is about the design, not a bug.
          </li>
        </ul>
        {top === undefined ? null : (
          <p>
            With {top.virtualUsers} virtual users the hot account reached {top.percent}% of the
            spread rate. The usual way around a hot account is to split it into several sub-accounts
            and add them up.
          </p>
        )}
        <p>
          Throughput hardly grows with more virtual users, while latency keeps climbing. That is
          saturation: the database's commit time is the limit, and extra load only queues. Latency
          here includes that waiting.
        </p>
      </section>

      <section aria-labelledby="charts" className="flex flex-col gap-8">
        <h2 id="charts" className="text-lg font-semibold">
          Results
        </h2>
        <SvgBarChart
          title="Transfers per second"
          description={describeChart(
            'Accepted transfers per second',
            'transfers per second',
            throughput,
            rounded,
          )}
          categories={categories}
          series={[
            { name: 'Spread', values: throughput.byScenario.spread },
            { name: 'Hot account', values: throughput.byScenario.hot },
          ]}
          unit="Transfers per second"
        />
        <SvgBarChart
          title="Latency at the 95th percentile"
          description={describeChart(
            'Latency of the 95th percentile (95% of requests were faster)',
            'milliseconds',
            p95,
            rounded,
          )}
          categories={categories}
          series={[
            { name: 'Spread', values: p95.byScenario.spread },
            { name: 'Hot account', values: p95.byScenario.hot },
          ]}
          unit="Milliseconds"
          format={rounded}
        />
      </section>

      <section aria-labelledby="table" className="flex flex-col gap-2">
        <h2 id="table" className="text-lg font-semibold">
          All the figures
        </h2>
        <Table caption="Every measured run" hideCaption>
          <thead>
            <tr>
              <Th numeric>Virtual users</Th>
              <Th>Scenario</Th>
              <Th numeric>Transfers/s</Th>
              <Th numeric>p50</Th>
              <Th numeric>p90</Th>
              <Th numeric>p95</Th>
              <Th numeric>p99</Th>
              <Th numeric>Max</Th>
              <Th numeric>Failed</Th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((run) => (
              <tr key={`${run.scenario}-${String(run.virtualUsers)}`}>
                <Td numeric>{run.virtualUsers}</Td>
                <Td>{run.scenario === 'spread' ? 'Spread' : 'Hot account'}</Td>
                <Td numeric>{rounded(run.transfersPerSecond)}</Td>
                <Td numeric>{ms(run.p50)}</Td>
                <Td numeric>{ms(run.p90)}</Td>
                <Td numeric>{ms(run.p95)}</Td>
                <Td numeric>{ms(run.p99)}</Td>
                <Td numeric>{ms(run.maxMs)}</Td>
                <Td numeric>{run.failedPercent}%</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="max-w-prose text-sm">
          p50 is the median; p95 means 95% of requests were faster than that. “Failed” is the share
          of requests that did not succeed.
        </p>
        {data.notes.length === 0 ? null : (
          <ul className="max-w-prose list-disc pl-5 text-sm">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="conditions" className="flex flex-col gap-2">
        <h2 id="conditions" className="text-lg font-semibold">
          Conditions
        </h2>
        <dl className="grid max-w-3xl grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="font-medium text-slate-700 dark:text-slate-300">ledgerd commit</dt>
          <dd>
            <a
              className="font-mono underline"
              href={`${LEDGERD_REPOSITORY}/commit/${source.ledgerdCommit}`}
              rel="noreferrer noopener"
            >
              {source.ledgerdCommit}
            </a>
          </dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Measured</dt>
          <dd>
            <Time iso={source.date} />
          </dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Load</dt>
          <dd>{source.load}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Hardware</dt>
          <dd>{env.hardware}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Memory</dt>
          <dd>{env.memory}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Operating system</dt>
          <dd>{env.os}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Container runtime</dt>
          <dd>{env.containerRuntime}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">PostgreSQL</dt>
          <dd>{env.postgres}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Configuration</dt>
          <dd>{env.configuration}</dd>
          <dt className="font-medium text-slate-700 dark:text-slate-300">Storage</dt>
          <dd>{env.storage}</dd>
        </dl>
      </section>
    </div>
  );
}
