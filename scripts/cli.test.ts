import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { benchmarkSchema } from '../src/features/benchmark/schema';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const fixtures = join(root, 'scripts', 'fixtures');

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-cli-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [tsx, join(root, 'scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const importArgs = (out: string, extra: string[] = []): string[] => [
  '--summary',
  join(fixtures, 'k6-summary.json'),
  '--environment',
  join(fixtures, 'environment.txt'),
  '--vus',
  '40',
  '--seconds',
  '20',
  '--out',
  out,
  ...extra,
];

// Each test starts a Node process and compiles TypeScript, which takes seconds on a busy machine.
describe('import-k6 (the command)', { timeout: 60_000 }, () => {
  it('writes a valid data file from the real k6 output, and says what it did', () => {
    const out = join(dir, 'a.json');
    const result = run('import-k6.ts', importArgs(out, ['--k6', '2.3.0']));
    expect(result.code).toBe(0);
    expect(result.out).toContain('2 row(s) for 40 virtual users at commit 7389ee7');
    const file = benchmarkSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(file.source.load).toBe('k6 2.3.0, 40 virtual users per scenario, 20 s per scenario');
  });

  it('adds to an existing file when the conditions are the same, and replaces the same row', () => {
    const out = join(dir, 'b.json');
    run('import-k6.ts', importArgs(out));
    const again = run('import-k6.ts', importArgs(out));
    expect(again.code).toBe(0);
    expect(benchmarkSchema.parse(JSON.parse(readFileSync(out, 'utf8'))).runs).toHaveLength(2);
  });

  it('refuses a --vus that does not match the summary, writing nothing', () => {
    const out = join(dir, 'c.json');
    const result = run('import-k6.ts', [
      ...importArgs(out).slice(0, 6),
      '--vus',
      '20',
      '--seconds',
      '20',
      '--out',
      out,
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/does not match the summary/);
    expect(() => readFileSync(out)).toThrow();
  });

  it('refuses to mix rows from other conditions, and says how to start afresh', () => {
    const out = join(dir, 'd.json');
    run('import-k6.ts', importArgs(out));
    const other = join(dir, 'other-env.txt');
    writeFileSync(
      other,
      readFileSync(join(fixtures, 'environment.txt'), 'utf8')
        .replace('7389ee7', 'abcdef0')
        .replace('(7389ee79b4a7)', ''),
    );
    const args = importArgs(out);
    args[3] = other;
    const result = run('import-k6.ts', args);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/ledgerd commit/);
    expect(result.err).toMatch(/--fresh/);
    expect(run('import-k6.ts', [...args, '--fresh']).code).toBe(0);
  });

  it('shows the usage, and fails, when something is missing', () => {
    const result = run('import-k6.ts', ['--vus', '40']);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/usage: import-k6/);
  });

  it('refuses numbers that are not positive whole numbers', () => {
    const out = join(dir, 'e.json');
    expect(
      run('import-k6.ts', [...importArgs(out).slice(0, 6), '--vus', 'abc', '--seconds', '20']).code,
    ).toBe(2);
  });
});

describe('check-benchmark (the command, part of npm run verify)', { timeout: 60_000 }, () => {
  it('passes the data file in the repository', () => {
    const result = run('check-benchmark.ts', []);
    expect(result.code).toBe(0);
    expect(result.out).toContain('data/benchmark.json: valid (6 runs)');
  });

  it('fails a file that is not valid, listing every problem', () => {
    const bad = join(dir, 'bad.json');
    const file = JSON.parse(readFileSync(join(root, 'data', 'benchmark.json'), 'utf8')) as {
      runs: Record<string, unknown>[];
      source: Record<string, unknown>;
    };
    file.runs[0] = { ...file.runs[0], p95: 1 }; // below p90/p50
    file.source.ledgerdCommit = 'main';
    writeFileSync(bad, JSON.stringify(file));
    const result = run('check-benchmark.ts', [bad]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/is not valid/);
    expect(result.err).toMatch(/source\.ledgerdCommit/);
    expect(result.err).toMatch(/runs\.0\.p95/);
  });

  it('fails on a file that is not JSON, or is missing', () => {
    const text = join(dir, 'text.json');
    writeFileSync(text, 'not json');
    expect(run('check-benchmark.ts', [text]).code).toBe(1);
    expect(run('check-benchmark.ts', [join(dir, 'nope.json')]).code).toBe(1);
  });
});
