/*
 * Checks the Dockerfile and docker-compose.yml against the rules in container-checks.ts.
 * Part of `npm run verify`; needs no Docker.
 */
import { readFileSync } from 'node:fs';

import { checkCompose, checkDockerfile } from './container-checks';

const problems = [
  ...checkDockerfile(readFileSync('Dockerfile', 'utf8')),
  ...checkCompose(readFileSync('docker-compose.yml', 'utf8')),
];
if (problems.length > 0) {
  process.stderr.write('check-containers found problems:\n');
  for (const p of problems) process.stderr.write(`  - ${p.file}: ${p.message}\n`);
  process.exit(1);
}
process.stdout.write('check-containers: Dockerfile and docker-compose.yml follow the rules.\n');
