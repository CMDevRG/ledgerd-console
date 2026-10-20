/*
 * Checks the GitHub workflows, Dependabot's configuration and the Playwright versions against
 * the rules in workflow-checks.ts. Part of `npm run verify`; needs no network and no Docker.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkDependabot,
  checkPipeline,
  checkPlaywrightVersions,
  checkWorkflow,
} from './workflow-checks';

const dir = '.github/workflows';
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

const problems = [
  ...(workflows.length === 0 ? [{ file: dir, message: 'has no workflow' }] : []),
  ...workflows.flatMap((f) => checkWorkflow(readFileSync(join(dir, f), 'utf8'), join(dir, f))),
  ...checkPipeline(readFileSync(join(dir, 'ci.yml'), 'utf8'), readFileSync('package.json', 'utf8')),
  ...checkDependabot(readFileSync('.github/dependabot.yml', 'utf8')),
  ...checkPlaywrightVersions(
    readFileSync('docker-compose.e2e.yml', 'utf8'),
    readFileSync('package.json', 'utf8'),
  ),
];
if (problems.length > 0) {
  process.stderr.write('check-workflows found problems:\n');
  for (const p of problems) process.stderr.write(`  - ${p.file}: ${p.message}\n`);
  process.exit(1);
}
process.stdout.write(
  `check-workflows: ${workflows.length} workflow(s), Dependabot and the Playwright versions follow the rules.\n`,
);
