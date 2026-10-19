/*
 * Fails (exit 1) if data/benchmark.json is not valid. Part of `npm run verify`, so a malformed
 * file stops the build and cannot reach a user.
 */
import { readFileSync } from 'node:fs';

import { benchmarkSchema } from '../src/features/benchmark/schema';

const file = process.argv[2] ?? 'data/benchmark.json';
try {
  const parsed = benchmarkSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    process.stderr.write(`${file} is not valid:\n`);
    for (const issue of parsed.error.issues) {
      process.stderr.write(`  - ${issue.path.join('.') || '(file)'}: ${issue.message}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`${file}: valid (${String(parsed.data.runs.length)} runs)\n`);
} catch (error) {
  process.stderr.write(`${file}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
