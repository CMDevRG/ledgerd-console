import { describe, expect, it } from 'vitest';

import { benchmarkSchema } from './schema';

const valid = () => ({
  schemaVersion: 1,
  source: {
    ledgerdCommit: '7389ee7',
    date: '2026-10-14T14:55:32Z',
    load: 'k6',
    secondsPerScenario: 20,
  },
  environment: {
    hardware: 'cpu',
    memory: '8 GiB',
    os: 'Linux',
    containerRuntime: 'Docker',
    postgres: 'PostgreSQL 16',
    configuration: 'default',
    storage: 'volume',
  },
  notes: [] as string[],
  runs: [
    {
      scenario: 'spread',
      virtualUsers: 10,
      transfersPerSecond: 210,
      p50: 41,
      p90: 60,
      p95: 85,
      p99: 145,
      maxMs: 300,
      failedPercent: 0,
    },
    {
      scenario: 'hot',
      virtualUsers: 10,
      transfersPerSecond: 69,
      p50: 147,
      p90: null,
      p95: 312,
      p99: 458,
      maxMs: null,
      failedPercent: 0,
    },
  ],
});
type Json = ReturnType<typeof valid>;
const with_ = (change: (d: Json) => void): unknown => {
  const d = valid();
  change(d);
  return d;
};
const errors = (value: unknown): string[] => {
  const r = benchmarkSchema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('benchmarkSchema', () => {
  it('accepts a good file, with figures that were not recorded as null', () => {
    expect(errors(valid())).toEqual([]);
  });

  it.each([
    [
      'another schema version',
      (d: Json) => {
        (d as { schemaVersion: number }).schemaVersion = 2;
      },
    ],
    [
      'no runs',
      (d: Json) => {
        d.runs = [];
      },
    ],
    [
      'an unknown scenario',
      (d: Json) => {
        (d.runs[0] as { scenario: string }).scenario = 'warm';
      },
    ],
    [
      'zero virtual users',
      (d: Json) => {
        (d.runs[0] as { virtualUsers: number }).virtualUsers = 0;
      },
    ],
    [
      'fractional virtual users',
      (d: Json) => {
        (d.runs[0] as { virtualUsers: number }).virtualUsers = 2.5;
      },
    ],
    [
      'negative throughput',
      (d: Json) => {
        (d.runs[0] as { transfersPerSecond: number }).transfersPerSecond = -1;
      },
    ],
    [
      'a latency that is not a number',
      (d: Json) => {
        (d.runs[0] as { p50: unknown }).p50 = '41';
      },
    ],
    [
      'a missing p50 (null is only for p90 and max)',
      (d: Json) => {
        (d.runs[0] as { p50: unknown }).p50 = null;
      },
    ],
    [
      'a failure rate above 100',
      (d: Json) => {
        (d.runs[0] as { failedPercent: number }).failedPercent = 101;
      },
    ],
    [
      'an infinite latency',
      (d: Json) => {
        (d.runs[0] as { p99: number }).p99 = Infinity;
      },
    ],
    [
      'an extra field in a run',
      (d: Json) => {
        (d.runs[0] as Record<string, unknown>).secret = 1;
      },
    ],
    [
      'an extra field in the file',
      (d: Json) => {
        (d as Record<string, unknown>).extra = 1;
      },
    ],
    [
      'a commit that is not hexadecimal',
      (d: Json) => {
        d.source.ledgerdCommit = 'main';
      },
    ],
    [
      'a date without a time',
      (d: Json) => {
        d.source.date = '2026-10-14';
      },
    ],
    [
      'an empty environment field',
      (d: Json) => {
        d.environment.postgres = '';
      },
    ],
    [
      'a missing environment field',
      (d: Json) => {
        delete (d.environment as Partial<Json['environment']>).storage;
      },
    ],
    [
      'a note that is empty',
      (d: Json) => {
        d.notes = [''];
      },
    ],
  ])('refuses %s', (_name, change) => {
    expect(errors(with_(change)).length).toBeGreaterThan(0);
  });

  it('refuses the same scenario at the same virtual users twice', () => {
    const e = errors(
      with_((d) => {
        d.runs.push({ ...d.runs[0] } as Json['runs'][number]);
      }),
    );
    expect(e).toContain('runs.2: duplicate run spread/10');
  });

  it('allows the same virtual users for the two scenarios, and one scenario at several virtual users', () => {
    expect(
      errors(
        with_((d) => {
          d.runs.push({ ...d.runs[0], virtualUsers: 20 } as Json['runs'][number]);
        }),
      ),
    ).toEqual([]);
  });

  it('refuses percentiles that decrease, and says which', () => {
    const e = errors(
      with_((d) => {
        (d.runs[0] as { p95: number }).p95 = 50;
      }),
    ); // below p90 = 60
    expect(e).toEqual(['runs.0.p95: p95 (50) is below p90 (60)']);
  });

  it('checks the order across a figure that was not recorded', () => {
    // p90 is null, so p95 is compared with p50.
    const e = errors(
      with_((d) => {
        (d.runs[1] as { p95: number }).p95 = 100;
      }),
    ); // below p50 = 147
    expect(e).toEqual(['runs.1.p95: p95 (100) is below p50 (147)']);
    expect(
      errors(
        with_((d) => {
          (d.runs[1] as { p99: number | null }).p99 = 300;
        }),
      ),
    ).toEqual(['runs.1.p99: p99 (300) is below p95 (312)']);
  });

  it('accepts equal percentiles (a quiet run can have p50 = p99)', () => {
    expect(
      errors(
        with_((d) => {
          Object.assign(d.runs[0] ?? {}, { p50: 5, p90: 5, p95: 5, p99: 5, maxMs: 5 });
        }),
      ),
    ).toEqual([]);
  });
});
