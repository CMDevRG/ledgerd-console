import type { BenchmarkRun, BenchmarkScenario } from './schema';

export interface Grouped {
  /** The distinct numbers of virtual users, ascending. */
  virtualUsers: number[];
  /** For each scenario, the value at each number of virtual users (null where not run). */
  byScenario: Record<BenchmarkScenario, (number | null)[]>;
}

type Pick = (run: BenchmarkRun) => number | null;

/** Lines the runs up for a chart: one value per scenario for each number of virtual users. */
export function groupByVirtualUsers(runs: readonly BenchmarkRun[], pick: Pick): Grouped {
  const virtualUsers = [...new Set(runs.map((r) => r.virtualUsers))].sort((a, b) => a - b);
  const at = (scenario: BenchmarkScenario): (number | null)[] =>
    virtualUsers.map((vu) => {
      const run = runs.find((r) => r.scenario === scenario && r.virtualUsers === vu);
      return run === undefined ? null : pick(run);
    });
  return { virtualUsers, byScenario: { spread: at('spread'), hot: at('hot') } };
}

/** The hot-account rate as a whole percentage of the spread rate, per number of virtual users. */
export function hotShareOfSpread(
  runs: readonly BenchmarkRun[],
): { virtualUsers: number; percent: number }[] {
  const grouped = groupByVirtualUsers(runs, (r) => r.transfersPerSecond);
  return grouped.virtualUsers.flatMap((vu, i) => {
    const spread = grouped.byScenario.spread[i];
    const hot = grouped.byScenario.hot[i];
    return spread != null && hot != null && spread > 0
      ? [{ virtualUsers: vu, percent: Math.round((hot / spread) * 100) }]
      : [];
  });
}

const listOf = (values: readonly (number | null)[], format: (n: number) => string): string =>
  values.map((v) => (v === null ? 'not recorded' : format(v))).join(', ');

/** A chart in words, for the people who cannot see it. */
export function describeChart(
  what: string,
  unit: string,
  grouped: Grouped,
  format: (n: number) => string,
): string {
  const users = grouped.virtualUsers.join(', ');
  return `${what}, in ${unit}, at ${users} virtual users. Spread scenario: ${listOf(grouped.byScenario.spread, format)}. Hot account scenario: ${listOf(grouped.byScenario.hot, format)}.`;
}

export const rounded = (n: number): string => String(Math.round(n));
