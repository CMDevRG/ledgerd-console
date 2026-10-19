import { describe, expect, it } from 'vitest';

import { describeChart, groupByVirtualUsers, hotShareOfSpread, rounded } from './derive';
import type { BenchmarkRun } from './schema';

const run = (
  scenario: 'spread' | 'hot',
  virtualUsers: number,
  tps: number,
  p95 = 100,
): BenchmarkRun => ({
  scenario,
  virtualUsers,
  transfersPerSecond: tps,
  p50: 1,
  p90: null,
  p95,
  p99: p95 + 1,
  maxMs: null,
  failedPercent: 0,
});

describe('groupByVirtualUsers', () => {
  it('lines the scenarios up by virtual users, in ascending order, whatever the order of the runs', () => {
    const runs = [
      run('hot', 40, 80),
      run('spread', 10, 210),
      run('hot', 10, 69),
      run('spread', 40, 274),
    ];
    expect(groupByVirtualUsers(runs, (r) => r.transfersPerSecond)).toEqual({
      virtualUsers: [10, 40],
      byScenario: { spread: [210, 274], hot: [69, 80] },
    });
  });

  it('leaves a gap (null) where a scenario was not run at that number of users', () => {
    const grouped = groupByVirtualUsers(
      [run('spread', 10, 210), run('spread', 20, 216), run('hot', 20, 75)],
      (r) => r.transfersPerSecond,
    );
    expect(grouped.byScenario).toEqual({ spread: [210, 216], hot: [null, 75] });
  });

  it('keeps a figure that was not recorded as null', () => {
    expect(groupByVirtualUsers([run('spread', 10, 1)], (r) => r.p90).byScenario.spread).toEqual([
      null,
    ]);
  });
});

describe('hotShareOfSpread', () => {
  it('is the hot rate as a rounded percentage of the spread rate', () => {
    expect(hotShareOfSpread([run('spread', 40, 274.4), run('hot', 40, 79.7)])).toEqual([
      { virtualUsers: 40, percent: 29 },
    ]);
  });

  it('skips a number of users where either side is missing, and never divides by zero', () => {
    expect(
      hotShareOfSpread([
        run('spread', 10, 210),
        run('hot', 20, 75),
        run('spread', 30, 0),
        run('hot', 30, 5),
      ]),
    ).toEqual([]);
  });
});

describe('describeChart', () => {
  it('says each series in words, with the gaps', () => {
    const grouped = { virtualUsers: [10, 20], byScenario: { spread: [210, 216], hot: [69, null] } };
    expect(describeChart('Throughput', 'transfers per second', grouped, rounded)).toBe(
      'Throughput, in transfers per second, at 10, 20 virtual users. Spread scenario: 210, 216. Hot account scenario: 69, not recorded.',
    );
  });
});
