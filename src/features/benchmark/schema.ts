import { z } from 'zod';

/*
 * The benchmark data file (data/benchmark.json). It is validated when the page loads and by
 * `npm run check:benchmark`, which is part of `npm run verify`, so a malformed file cannot
 * reach a user. Every field is something that was measured or recorded; where a figure was
 * not recorded the file says `null`, and the page says "not recorded" rather than guessing.
 */

const ms = z.number().nonnegative();

export const runSchema = z
  .object({
    scenario: z.enum(['spread', 'hot']),
    virtualUsers: z.number().int().positive(),
    /** Accepted transfers per second over the scenario's duration. */
    transfersPerSecond: z.number().nonnegative(),
    p50: ms,
    p90: ms.nullable(),
    p95: ms,
    p99: ms,
    maxMs: ms.nullable(),
    failedPercent: z.number().min(0).max(100),
  })
  .strict();

export const environmentSchema = z
  .object({
    hardware: z.string().min(1),
    memory: z.string().min(1),
    os: z.string().min(1),
    containerRuntime: z.string().min(1),
    postgres: z.string().min(1),
    configuration: z.string().min(1),
    storage: z.string().min(1),
  })
  .strict();

export const sourceSchema = z
  .object({
    /** The ledgerd commit that was measured. */
    ledgerdCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    /** When the environment was recorded (UTC, ISO 8601). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    load: z.string().min(1),
    secondsPerScenario: z.number().int().positive(),
  })
  .strict();

export const benchmarkSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: sourceSchema,
    environment: environmentSchema,
    /** Things a reader needs to know that the numbers do not say. */
    notes: z.array(z.string().min(1)),
    runs: z.array(runSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.runs.forEach((run, i) => {
      const key = `${run.scenario}/${String(run.virtualUsers)}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['runs', i], message: `duplicate run ${key}` });
      }
      seen.add(key);

      // Percentiles cannot decrease: p50 <= p90 <= p95 <= p99 <= max, where recorded.
      const ordered: [string, number | null][] = [
        ['p50', run.p50],
        ['p90', run.p90],
        ['p95', run.p95],
        ['p99', run.p99],
        ['maxMs', run.maxMs],
      ];
      let previous: [string, number] | undefined;
      for (const [name, value] of ordered) {
        if (value === null) continue;
        if (previous !== undefined && value < previous[1]) {
          ctx.addIssue({
            code: 'custom',
            path: ['runs', i, name],
            message: `${name} (${String(value)}) is below ${previous[0]} (${String(previous[1])})`,
          });
        }
        previous = [name, value];
      }
    });
  });

export type Benchmark = z.infer<typeof benchmarkSchema>;
export type BenchmarkRun = z.infer<typeof runSchema>;
export type BenchmarkEnvironment = z.infer<typeof environmentSchema>;
export type BenchmarkSource = z.infer<typeof sourceSchema>;
export type BenchmarkScenario = BenchmarkRun['scenario'];
