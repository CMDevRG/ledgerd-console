import { z } from 'zod';

import {
  benchmarkSchema,
  type Benchmark,
  type BenchmarkEnvironment,
  type BenchmarkRun,
  type BenchmarkScenario,
  type BenchmarkSource,
} from '../src/features/benchmark/schema';

/*
 * Turns the output of ledgerd's `make bench` (bench/results/summary.json and environment.txt)
 * into rows of data/benchmark.json. Pure functions: the script around them reads and writes
 * the files.
 */

const SCENARIO_ORDER: readonly BenchmarkScenario[] = ['spread', 'hot'];

const trendValues = z.object({
  med: z.number(),
  'p(90)': z.number(),
  'p(95)': z.number(),
  'p(99)': z.number(),
  max: z.number(),
});
const metric = <T extends z.ZodType>(values: T) => z.object({ values });

const summarySchema = z.object({
  metrics: z.record(z.string(), z.unknown()),
});

export interface ImportOptions {
  /** Virtual users per scenario: the VUS the run was made with (k6's summary does not say). */
  vus: number;
  /** Seconds each scenario ran: the DURATION the run was made with. */
  seconds: number;
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** The rows of one k6 summary: one for each scenario that was run. */
export function runsFromSummary(summary: unknown, options: ImportOptions): BenchmarkRun[] {
  const { metrics } = summarySchema.parse(summary);
  const scenarios = SCENARIO_ORDER.filter((name) => `iterations{scenario:${name}}` in metrics);
  if (scenarios.length === 0) {
    throw new Error('the summary has no per-scenario metrics (iterations{scenario:spread|hot})');
  }

  // The summary does not record VUS; k6 reports the most virtual users it prepared, which is
  // VUS for each scenario. A wrong --vus would label the numbers wrongly, so check it.
  const vusMax = metric(z.object({ value: z.number() })).safeParse(metrics.vus_max);
  if (vusMax.success) {
    const expected = options.vus * scenarios.length;
    if (vusMax.data.values.value !== expected) {
      throw new Error(
        `--vus ${String(options.vus)} does not match the summary: it prepared ${String(vusMax.data.values.value)} virtual users for ${String(scenarios.length)} scenario(s), which means ${String(vusMax.data.values.value / scenarios.length)} each`,
      );
    }
  }

  return scenarios.map((scenario): BenchmarkRun => {
    const duration = metric(trendValues).parse(
      metrics[`http_req_duration{scenario:${scenario}}`],
    ).values;
    const iterations = metric(z.object({ count: z.number() })).parse(
      metrics[`iterations{scenario:${scenario}}`],
    ).values;
    const failed = metric(z.object({ rate: z.number() })).parse(
      metrics[`http_req_failed{scenario:${scenario}}`],
    ).values;
    return {
      scenario,
      virtualUsers: options.vus,
      transfersPerSecond: round(iterations.count / options.seconds, 1),
      p50: round(duration.med, 1),
      p90: round(duration['p(90)'], 1),
      p95: round(duration['p(95)'], 1),
      p99: round(duration['p(99)'], 1),
      maxMs: round(duration.max, 1),
      failedPercent: round(failed.rate * 100, 2),
    };
  });
}

export interface Recorded {
  source: Pick<BenchmarkSource, 'ledgerdCommit' | 'date'>;
  environment: BenchmarkEnvironment;
}

/** Reads the `key: value` lines that scripts/bench-env.sh writes. */
export function parseEnvironment(text: string): Recorded {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z][A-Za-z ]*?):\s+(.+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) fields.set(match[1], match[2].trim());
  }
  const need = (key: string): string => {
    const value = fields.get(key);
    if (value === undefined || value === '')
      throw new Error(`environment.txt has no "${key}:" line`);
    return value;
  };
  return {
    source: { ledgerdCommit: need('commit'), date: need('date') },
    environment: {
      hardware: need('CPU'),
      memory: need('memory'),
      os: need('host OS'),
      containerRuntime: `Docker ${need('docker')}; ${need('docker VM')}`,
      postgres: need('postgres').replace(/^postgres \(PostgreSQL\) /, 'PostgreSQL '),
      configuration: need('db pool'),
      storage: need('storage'),
    },
  };
}

export interface Incoming extends Recorded {
  load: string;
  secondsPerScenario: number;
  runs: BenchmarkRun[];
}

const sortRuns = (runs: BenchmarkRun[]): BenchmarkRun[] =>
  [...runs].sort(
    (a, b) =>
      a.virtualUsers - b.virtualUsers ||
      SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario),
  );

/**
 * Adds new rows to the data file, or starts a new file.
 *
 * Rows from different commits, machines or durations are not comparable, so merging refuses
 * them unless `fresh` is set, which throws the old rows away. A row for the same scenario and
 * virtual users replaces the old one.
 */
export function mergeBenchmark(
  existing: Benchmark | undefined,
  incoming: Incoming,
  mode: 'merge' | 'fresh',
): Benchmark {
  const file: Benchmark = {
    schemaVersion: 1,
    source: {
      ledgerdCommit: incoming.source.ledgerdCommit,
      date: incoming.source.date,
      load: incoming.load,
      secondsPerScenario: incoming.secondsPerScenario,
    },
    environment: incoming.environment,
    notes: [],
    runs: sortRuns(incoming.runs),
  };
  if (existing === undefined || mode === 'fresh') return benchmarkSchema.parse(file);

  const differences = [
    existing.source.ledgerdCommit !== incoming.source.ledgerdCommit &&
      `ledgerd commit (${existing.source.ledgerdCommit} in the file, ${incoming.source.ledgerdCommit} in the new run)`,
    existing.source.secondsPerScenario !== incoming.secondsPerScenario &&
      `duration (${String(existing.source.secondsPerScenario)} s in the file, ${String(incoming.secondsPerScenario)} s in the new run)`,
    JSON.stringify(existing.environment) !== JSON.stringify(incoming.environment) &&
      'environment (hardware, software or configuration)',
  ].filter((d): d is string => d !== false);
  if (differences.length > 0) {
    throw new Error(
      `the new run differs from the file in: ${differences.join('; ')}. Rows measured under different conditions cannot sit side by side. Use --fresh to start a new file.`,
    );
  }

  const replaced = new Set(incoming.runs.map((r) => `${r.scenario}/${String(r.virtualUsers)}`));
  const kept = existing.runs.filter(
    (r) => !replaced.has(`${r.scenario}/${String(r.virtualUsers)}`),
  );
  return benchmarkSchema.parse({
    ...existing,
    runs: sortRuns([...kept, ...incoming.runs]),
  } satisfies Benchmark);
}
