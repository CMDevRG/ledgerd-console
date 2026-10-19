/*
 * Usage (from the repository root):
 *
 *   npx tsx scripts/import-k6.ts --summary <summary.json> --environment <environment.txt> \
 *     --vus 40 --seconds 20 [--k6 2.3.0] [--out data/benchmark.json] [--fresh]
 *
 * <summary.json> and <environment.txt> are what `make bench` leaves in ledgerd's
 * bench/results/. --vus and --seconds are the VUS and DURATION that run was made with (k6's
 * summary does not record them). The script prints what it will change; review the diff of
 * data/benchmark.json before committing it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { benchmarkSchema, type Benchmark } from '../src/features/benchmark/schema';
import { mergeBenchmark, parseEnvironment, runsFromSummary } from './import-k6-lib';

function main(): number {
  const { values } = parseArgs({
    options: {
      summary: { type: 'string' },
      environment: { type: 'string' },
      vus: { type: 'string' },
      seconds: { type: 'string' },
      k6: { type: 'string' },
      out: { type: 'string', default: 'data/benchmark.json' },
      fresh: { type: 'boolean', default: false },
    },
  });
  const { summary, environment, vus, seconds, out, k6, fresh } = values;
  if (!summary || !environment || !vus || !seconds) {
    process.stderr.write(
      'usage: import-k6 --summary FILE --environment FILE --vus N --seconds N [--k6 VERSION] [--out FILE] [--fresh]\n',
    );
    return 2;
  }
  const vusNumber = Number.parseInt(vus, 10);
  const secondsNumber = Number.parseInt(seconds, 10);
  if (!(vusNumber > 0) || !(secondsNumber > 0)) {
    process.stderr.write('--vus and --seconds must be positive whole numbers\n');
    return 2;
  }

  try {
    const recorded = parseEnvironment(readFileSync(environment, 'utf8'));
    const runs = runsFromSummary(JSON.parse(readFileSync(summary, 'utf8')) as unknown, {
      vus: vusNumber,
      seconds: secondsNumber,
    });
    const existing: Benchmark | undefined = existsSync(out)
      ? benchmarkSchema.parse(JSON.parse(readFileSync(out, 'utf8')))
      : undefined;
    const merged = mergeBenchmark(
      existing,
      {
        ...recorded,
        load: `k6${k6 ? ` ${k6}` : ''}, ${String(vusNumber)} virtual users per scenario, ${String(secondsNumber)} s per scenario`,
        secondsPerScenario: secondsNumber,
        runs,
      },
      fresh ? 'fresh' : 'merge',
    );
    writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
    process.stdout.write(
      `${out}: ${String(runs.length)} row(s) for ${String(vusNumber)} virtual users at commit ${recorded.source.ledgerdCommit}; the file now has ${String(merged.runs.length)} row(s).\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`import-k6: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(main());
