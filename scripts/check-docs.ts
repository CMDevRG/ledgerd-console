/*
 * Checks the README and the decision records against the rules in docs-checks.ts. Part of
 * `npm run verify`; needs no network and no Docker.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkAdrs, checkReadme } from './docs-checks';

const packageJson = readFileSync('package.json', 'utf8');
const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;
const makeTargets = new Set(
  [...readFileSync('Makefile', 'utf8').matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((m) => m[1] ?? ''),
);

const adrDir = 'docs/adr';
const adrs = Object.fromEntries(
  readdirSync(adrDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => [f, readFileSync(join(adrDir, f), 'utf8')]),
);

const problems = [
  ...checkReadme(readFileSync('README.md', 'utf8'), {
    screenshots: readdirSync('docs/screenshots').filter((f) => f.endsWith('.png')),
    exists: existsSync,
    npmScripts: new Set(Object.keys(scripts)),
    makeTargets,
    packageJson,
    compose: readFileSync('docker-compose.yml', 'utf8'),
    serverConfig: readFileSync('server/src/config.ts', 'utf8'),
  }),
  ...checkAdrs(adrs, adrs['README.md'] ?? ''),
];
if (problems.length > 0) {
  process.stderr.write('check-docs found problems:\n');
  for (const p of problems) process.stderr.write(`  - ${p.file}: ${p.message}\n`);
  process.exit(1);
}
process.stdout.write('check-docs: the README and the decision records follow the rules.\n');
