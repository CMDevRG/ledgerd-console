import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { benchmarkSchema, type Benchmark } from '../src/features/benchmark/schema';
import { mergeBenchmark, parseEnvironment, runsFromSummary, type Incoming } from './import-k6-lib';

const here = dirname(fileURLToPath(import.meta.url));
// Real output of ledgerd's `make bench` (40 virtual users, 20 s per scenario, commit 7389ee7).
const summary: unknown = JSON.parse(
  readFileSync(join(here, 'fixtures', 'k6-summary.json'), 'utf8'),
);
const environmentText = readFileSync(join(here, 'fixtures', 'environment.txt'), 'utf8');
const dataFile: unknown = JSON.parse(
  readFileSync(join(here, '..', 'data', 'benchmark.json'), 'utf8'),
);

const options = { vus: 40, seconds: 20 };

describe('runsFromSummary (real k6 output)', () => {
  it('turns the summary into a row per scenario, with throughput over the scenario duration', () => {
    expect(runsFromSummary(summary, options)).toEqual([
      {
        scenario: 'spread',
        virtualUsers: 40,
        transfersPerSecond: 274.4,
        p50: 137.3,
        p90: 189.7,
        p95: 214.8,
        p99: 294.6,
        maxMs: 486.4,
        failedPercent: 0,
      },
      {
        scenario: 'hot',
        virtualUsers: 40,
        transfersPerSecond: 79.7,
        p50: 511.2,
        p90: 632.2,
        p95: 708.8,
        p99: 856.2,
        maxMs: 1185.2,
        failedPercent: 0,
      },
    ]);
  });

  it('divides the iterations by the scenario duration, not by the whole run', () => {
    // 5488 spread iterations in 20 s is 274.4 per second; over the whole 47 s run it would be 116.5.
    expect(runsFromSummary(summary, options)[0]?.transfersPerSecond).toBe(274.4);
    expect(runsFromSummary(summary, { vus: 40, seconds: 40 })[0]?.transfersPerSecond).toBe(137.2);
  });

  it('reports the failed requests as a percentage', () => {
    const failing = JSON.parse(JSON.stringify(summary)) as {
      metrics: Record<string, { values: { rate: number } }>;
    };
    const spread = failing.metrics['http_req_failed{scenario:spread}'];
    if (spread === undefined) throw new Error('the fixture has no spread failure rate');
    spread.values.rate = 0.0123;
    expect(runsFromSummary(failing, options)[0]?.failedPercent).toBe(1.23);
  });

  it('refuses a --vus that does not match what k6 prepared', () => {
    expect(() => runsFromSummary(summary, { vus: 20, seconds: 20 })).toThrow(
      /does not match the summary/,
    );
    expect(() => runsFromSummary(summary, { vus: 80, seconds: 20 })).toThrow(
      /does not match the summary/,
    );
  });

  it('refuses a file that is not a k6 summary of this benchmark', () => {
    expect(() => runsFromSummary({ metrics: {} }, options)).toThrow(/no per-scenario metrics/);
    expect(() => runsFromSummary({}, options)).toThrow();
    expect(() => runsFromSummary('text', options)).toThrow();
  });

  it('handles a run of one scenario only', () => {
    const full = JSON.parse(JSON.stringify(summary)) as {
      metrics: Record<string, { values: { value?: number } }>;
    };
    const metrics = Object.fromEntries(
      Object.entries(full.metrics).filter(([key]) => !key.includes('scenario:hot')),
    );
    metrics.vus_max = { values: { value: 40 } };
    const only = { metrics };
    expect(runsFromSummary(only, options).map((r) => r.scenario)).toEqual(['spread']);
  });
});

describe('parseEnvironment (real environment.txt)', () => {
  it('reads the commit, the date and the environment', () => {
    expect(parseEnvironment(environmentText)).toEqual({
      source: { ledgerdCommit: '7389ee7', date: '2026-10-14T14:55:32Z' },
      environment: {
        hardware: 'AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx (8 logical cores visible)',
        memory: '6.7 GiB visible to this environment',
        os: 'Linux 6.18.33.2-microsoft-standard-WSL2',
        containerRuntime: 'Docker 29.7.2 (linux/amd64); 8 CPUs, Docker Desktop',
        postgres: 'PostgreSQL 16.15',
        configuration: 'LEDGERD_DB_MAX_CONNS=20 (default)',
        storage:
          'PostgreSQL data on a Docker named volume (default fsync/synchronous_commit settings)',
      },
    });
  });

  it.each([
    'date',
    'commit',
    'CPU',
    'memory',
    'host OS',
    'docker',
    'docker VM',
    'postgres',
    'db pool',
    'storage',
  ])('says which line is missing: %s', (key) => {
    const without = environmentText
      .split('\n')
      .filter((l) => !l.startsWith(`${key}:`))
      .join('\n');
    expect(() => parseEnvironment(without)).toThrow(`"${key}:"`);
  });
});

const incoming = (over: Partial<Incoming> = {}): Incoming => ({
  ...parseEnvironment(environmentText),
  load: 'k6 2.3.0, 40 virtual users per scenario, 20 s per scenario',
  secondsPerScenario: 20,
  runs: runsFromSummary(summary, options),
  ...over,
});

describe('mergeBenchmark', () => {
  it('starts a file when there is none', () => {
    const file = mergeBenchmark(undefined, incoming(), 'merge');
    expect(file.runs).toHaveLength(2);
    expect(file.source).toMatchObject({ ledgerdCommit: '7389ee7', secondsPerScenario: 20 });
    expect(benchmarkSchema.safeParse(file).success).toBe(true);
  });

  it('adds rows for other virtual users from the same conditions, sorted by users then scenario', () => {
    const base = mergeBenchmark(undefined, incoming(), 'merge');
    const twenty = incoming({
      runs: runsFromSummary(summary, options).map((r) => ({ ...r, virtualUsers: 20 })),
    });
    const merged = mergeBenchmark(base, twenty, 'merge');
    expect(merged.runs.map((r) => `${String(r.virtualUsers)}/${r.scenario}`)).toEqual([
      '20/spread',
      '20/hot',
      '40/spread',
      '40/hot',
    ]);
  });

  it('replaces the row for the same scenario and virtual users, keeping the others', () => {
    const base = mergeBenchmark(undefined, incoming(), 'merge');
    const better = incoming({
      runs: runsFromSummary(summary, options)
        .map((r) => ({ ...r, transfersPerSecond: 999 }))
        .slice(0, 1),
    });
    const merged = mergeBenchmark(base, better, 'merge');
    expect(merged.runs.map((r) => [r.scenario, r.transfersPerSecond])).toEqual([
      ['spread', 999],
      ['hot', 79.7],
    ]);
  });

  it.each([
    [
      'a different commit',
      { source: { ledgerdCommit: 'abcdef0', date: '2026-10-14T14:55:32Z' } },
      /ledgerd commit/,
    ],
    ['a different duration', { secondsPerScenario: 60 }, /duration/],
    [
      'a different machine',
      {
        environment: { ...parseEnvironment(environmentText).environment, hardware: 'another CPU' },
      },
      /environment/,
    ],
  ])('refuses to put rows from %s beside the others', (_name, change, message) => {
    const base = mergeBenchmark(undefined, incoming(), 'merge');
    expect(() => mergeBenchmark(base, incoming(change), 'merge')).toThrow(message);
    expect(() => mergeBenchmark(base, incoming(change), 'merge')).toThrow(/--fresh/);
  });

  it('starts over, dropping the old rows, when told to', () => {
    const base = mergeBenchmark(undefined, incoming(), 'merge');
    const other = incoming({
      source: { ledgerdCommit: 'abcdef0', date: '2026-11-01T00:00:00Z' },
      runs: runsFromSummary(summary, options).slice(0, 1),
    });
    const fresh = mergeBenchmark(base, other, 'fresh');
    expect(fresh.source.ledgerdCommit).toBe('abcdef0');
    expect(fresh.runs).toHaveLength(1);
  });

  it('does not carry the old notes over to measurements they were not written about', () => {
    const base: Benchmark = {
      ...mergeBenchmark(undefined, incoming(), 'merge'),
      notes: ['about the old rows'],
    };
    expect(
      mergeBenchmark(
        base,
        incoming({ source: { ledgerdCommit: 'abcdef0', date: '2026-11-01T00:00:00Z' } }),
        'fresh',
      ).notes,
    ).toEqual([]);
  });
});

describe('data/benchmark.json', () => {
  const file = benchmarkSchema.parse(dataFile);

  it('is valid', () => {
    expect(benchmarkSchema.safeParse(dataFile).success).toBe(true);
  });

  it('agrees with the importer: the 40 virtual-user rows are exactly what it makes from the real k6 output', () => {
    expect(file.runs.filter((r) => r.virtualUsers === 40)).toEqual(
      runsFromSummary(summary, options),
    );
    expect(file.source.ledgerdCommit).toBe(parseEnvironment(environmentText).source.ledgerdCommit);
    expect(file.environment).toEqual(parseEnvironment(environmentText).environment);
  });

  it('has the sweep the README publishes: 10, 20 and 40 virtual users, both scenarios', () => {
    expect(file.runs.map((r) => `${String(r.virtualUsers)}/${r.scenario}`)).toEqual([
      '10/spread',
      '10/hot',
      '20/spread',
      '20/hot',
      '40/spread',
      '40/hot',
    ]);
  });

  it('says which figures were not recorded rather than inventing them', () => {
    for (const run of file.runs.filter((r) => r.virtualUsers < 40)) {
      expect(run.p90).toBeNull();
      expect(run.maxMs).toBeNull();
    }
    expect(file.notes.join(' ')).toMatch(/recorded as null/);
  });
});
