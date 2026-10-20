/*
 * Fails if docs/traceability.md names a test that does not exist, or leaves a criterion of
 * requirements.md out (R16.7). The tests are listed by the runners themselves (Vitest and
 * Playwright), so "exists" means "the runner would run it". Part of `npm run verify`; needs
 * neither Docker nor a browser.
 *
 *   tsx scripts/check-traceability.ts [matrix.md] [--partial]
 *   tsx scripts/check-traceability.ts --list     # every test the runners know, as `file<TAB>name`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { checkTraceability, type ListedTest } from './traceability';

const MATRIX = 'docs/traceability.md';
const REQUIREMENTS = '.kiro/specs/console/requirements.md';

function run(args: string[]): string {
  return execFileSync('npx', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const posix = (path: string): string => relative(process.cwd(), path).split('\\').join('/');

function vitestTests(): ListedTest[] {
  const listed = JSON.parse(run(['vitest', 'list', '--json'])) as { name: string; file: string }[];
  // `vitest list` writes a quotation mark in a test's name as backslash + quotation mark.
  return listed.map((t) => ({ file: posix(t.file), name: t.name.replaceAll('\\"', '"') }));
}

interface PlaywrightSuite {
  title?: string;
  file?: string;
  specs?: { title: string; file: string }[];
  suites?: PlaywrightSuite[];
}

function playwrightTests(): ListedTest[] {
  const config = 'e2e/playwright.config.ts';
  const report = JSON.parse(
    run(['playwright', 'test', '--list', '--reporter=json', '--config', config]),
  ) as { suites: PlaywrightSuite[] };
  const tests: ListedTest[] = [];
  const walk = (suite: PlaywrightSuite, path: string[]): void => {
    for (const spec of suite.specs ?? []) {
      // File names are relative to the test directory, which is e2e/.
      tests.push({
        file: posix(resolve('e2e', spec.file)),
        name: [...path, spec.title].join(' > '),
      });
    }
    for (const child of suite.suites ?? []) {
      const isFile = child.title === child.file;
      walk(child, isFile || child.title === undefined ? path : [...path, child.title]);
    }
  };
  for (const suite of report.suites) walk(suite, []);
  return tests;
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const t of [...vitestTests(), ...playwrightTests()])
    process.stdout.write(`${t.file}\t${t.name}\n`);
  process.exit(0);
}
const matrixPath = args.find((a) => !a.startsWith('--')) ?? MATRIX;
const partial = args.includes('--partial');

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const makeTargets = new Set(
  [...readFileSync('Makefile', 'utf8').matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((m) => m[1] ?? ''),
);

const problems = checkTraceability(
  readFileSync(REQUIREMENTS, 'utf8'),
  readFileSync(matrixPath, 'utf8'),
  {
    tests: [...vitestTests(), ...playwrightTests()],
    npmScripts: new Set(Object.keys(pkg.scripts)),
    makeTargets,
  },
  { partial, file: matrixPath },
);
if (problems.length > 0) {
  process.stderr.write('check-traceability found problems:\n');
  for (const p of problems) process.stderr.write(`  - ${p.message}\n`);
  process.exit(1);
}
process.stdout.write(
  `check-traceability: ${matrixPath} is consistent with the tests and requirements.\n`,
);
