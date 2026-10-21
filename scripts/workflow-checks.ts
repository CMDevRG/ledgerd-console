/*
 * Static checks of the GitHub workflows and Dependabot's configuration: what must hold for
 * the pipeline to be reproducible and to give an attacker nothing to work with. Pure functions
 * over the file text (like container-checks.ts), so each rule can be shown to fail;
 * scripts/check-workflows.ts runs them on the real files.
 *
 * These are line-based checks, not a YAML parser: the workflows are written in a plain style
 * (see .github/workflows/ci.yml) and the checks rely on it. `actionlint` covers the syntax.
 */
import type { Problem } from './container-checks';

const PINNED_ACTION = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}\s+#\s*v\d+(?:\.\d+){0,2}\s*$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The lines of every `- uses:` step, with the lines of the step's own `with:` block. */
function usesSteps(lines: string[]): { uses: string; line: number; block: string[] }[] {
  const steps: { uses: string; line: number; block: string[] }[] = [];
  lines.forEach((text, i) => {
    const match = /^(\s*)-\s+uses:\s*(.*)$/.exec(text);
    if (match === null) return;
    const dash = (match[1] ?? '').length;
    const block: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() === '') continue;
      if (indentOf(next) <= dash) break; // the next step, or the end of the steps
      block.push(next.trim());
    }
    steps.push({ uses: (match[2] ?? '').trim(), line: i + 1, block });
  });
  return steps;
}

/** The jobs of a workflow: the lines under each name at the first indent level of `jobs:`. */
function jobs(lines: string[]): { name: string; lines: string[] }[] {
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const found: { name: string; lines: string[] }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break;
    const name = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)?.[1];
    if (name !== undefined) found.push({ name, lines: [] });
    else found.at(-1)?.lines.push(line);
  }
  return found;
}

export function checkWorkflow(text: string, file: string): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string): void => {
    problems.push({ file, message });
  };
  const lines = text.split('\n');

  for (const step of usesSteps(lines)) {
    if (step.uses.startsWith('./')) continue; // an action of this repository
    if (!PINNED_ACTION.test(step.uses)) {
      add(
        `line ${step.line}: "${step.uses}" is not pinned to a 40-character commit SHA followed by "# vX.Y.Z"`,
      );
    }
    if (
      step.uses.startsWith('actions/checkout@') &&
      !step.block.includes('persist-credentials: false')
    ) {
      add(`line ${step.line}: actions/checkout must set persist-credentials: false`);
    }
  }

  const permissions = lines.findIndex((l) => l.startsWith('permissions:'));
  if (permissions < 0) {
    add('no top-level "permissions:" (the token would get the repository default)');
  } else if ((lines[permissions] ?? '').includes('write-all')) {
    add('permissions: write-all');
  }
  if (lines.some((l) => /^\s+\S+:\s*write\s*$/.test(l))) {
    add('a permission is granted as write; nothing in this pipeline writes to the repository');
  }

  if (lines.some((l) => /\bpull_request_target\b/.test(l))) {
    add('uses pull_request_target, which runs with secrets on code from a fork');
  }
  // Text taken from the event (a branch name, a PR title) and put into a script is injection.
  const injection = lines.findIndex((l) => /\$\{\{\s*github\.(?:event\.|head_ref)/.test(l));
  if (injection >= 0)
    add(`line ${injection + 1}: puts text controlled by the author into the workflow`);

  const found = jobs(lines);
  if (found.length === 0) add('has no jobs');
  for (const job of found) {
    if (!job.lines.some((l) => /^ {4}timeout-minutes:\s*\d+\s*$/.test(l))) {
      add(`job "${job.name}" has no timeout-minutes (a hung job would run for six hours)`);
    }
    if (!job.lines.some((l) => /^ {4}runs-on:\s*ubuntu-\d+\.\d+\s*$/.test(l))) {
      add(`job "${job.name}" does not run on a named Ubuntu version (not ubuntu-latest)`);
    }
  }
  return problems;
}

const ECOSYSTEMS = ['npm', 'github-actions', 'docker', 'docker-compose'] as const;

export function checkDependabot(text: string, file = '.github/dependabot.yml'): Problem[] {
  const present = new Set(
    [...text.matchAll(/^\s*-\s*package-ecosystem:\s*["']?([\w-]+)["']?\s*$/gm)].map((m) => m[1]),
  );
  return ECOSYSTEMS.filter((e) => !present.has(e)).map((e) => ({
    file,
    message: `does not keep "${e}" up to date`,
  }));
}

/**
 * The Playwright container and the @playwright/test package must be the same version: a
 * browser and a driver that disagree fail in ways that look like a broken test.
 */
export function checkPlaywrightVersions(composeE2e: string, packageJson: string): Problem[] {
  const file = 'docker-compose.e2e.yml';
  const image =
    /image:\s*mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-\S+@sha256:[0-9a-f]{64}/.exec(
      composeE2e,
    );
  if (image === null) {
    return [{ file, message: 'the Playwright image is not pinned by version and digest' }];
  }
  const pkg = JSON.parse(packageJson) as { devDependencies?: Record<string, string> };
  const wanted = pkg.devDependencies?.['@playwright/test'];
  if (wanted !== image[1]) {
    return [
      {
        file,
        message: `the Playwright image is ${image[1] ?? '?'} but @playwright/test is ${wanted ?? 'missing'}`,
      },
    ];
  }
  return [];
}

/** What requirement R16.5 says continuous integration must run, as the commands that run it. */
const REQUIRED_COMMANDS = [
  'npm run check:api', // the generated API types are current
  'npm run verify:ci', // types, lint, format, tests with coverage, build and its scans
  'npm run audit', // known vulnerabilities in production dependencies
  'make e2e-up', // the real stack, from the pinned ledgerd release images
  'make e2e-run', // the browser tests against it
  'make screenshots-run', // the README screenshots, from the same tests' world
  'make smoke',
];

/** What `npm run verify:ci` has to include, directly or through the scripts it calls. */
const REQUIRED_SCRIPTS = [
  'typecheck',
  'check:api-types',
  'lint',
  'format:check',
  'coverage',
  'build',
  'check:build',
  'check:workflows',
  'check:traceability',
  'check:docs',
];

function expand(
  scripts: Record<string, string>,
  name: string,
  seen = new Set<string>(),
): Set<string> {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const call of (scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/g)) {
    expand(scripts, call[1] ?? '', seen);
  }
  return seen;
}

export function checkPipeline(workflow: string, packageJson: string, file = 'ci.yml'): Problem[] {
  const problems: Problem[] = [];
  const lines = workflow.split('\n').map((l) => l.trim());
  for (const command of REQUIRED_COMMANDS) {
    if (!lines.some((l) => l === `- run: ${command}` || l === `run: ${command}`)) {
      problems.push({ file, message: `the pipeline does not run "${command}"` });
    }
  }
  // The browser is in a container, but the test files import @playwright/test from node_modules:
  // the job that runs them must install it (this failed on the first run on GitHub).
  const e2e = jobs(workflow.split('\n')).find((job) => job.name === 'e2e');
  if (!e2e?.lines.some((l) => /^\s*-?\s*run: npm ci\b/.test(l))) {
    problems.push({
      file,
      message: 'the e2e job does not run "npm ci" (the tests import node_modules)',
    });
  }
  if (!workflow.includes('path: docs/screenshots')) {
    problems.push({ file, message: 'the pipeline does not keep the screenshots as an artifact' });
  }
  const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;
  const included = expand(scripts, 'verify:ci');
  for (const name of REQUIRED_SCRIPTS) {
    if (!included.has(name)) {
      problems.push({ file: 'package.json', message: `"verify:ci" does not include "${name}"` });
    }
  }
  return problems;
}
