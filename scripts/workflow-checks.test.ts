import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkDependabot, checkPlaywrightVersions, checkWorkflow } from './workflow-checks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const ci = read('.github/workflows/ci.yml');

const SHA = 'a'.repeat(40);
const CHECKOUT = /actions\/checkout@[0-9a-f]{40} # v[\d.]+/;

describe('the real files follow the rules', () => {
  it('the CI workflow', () => {
    expect(checkWorkflow(ci, 'ci.yml')).toEqual([]);
  });
  it('Dependabot', () => {
    expect(checkDependabot(read('.github/dependabot.yml'))).toEqual([]);
  });
  it('the Playwright container and package agree', () => {
    expect(checkPlaywrightVersions(read('docker-compose.e2e.yml'), read('package.json'))).toEqual(
      [],
    );
  });
});

describe('checkWorkflow', () => {
  const messages = (text: string): string =>
    checkWorkflow(text, 'w.yml')
      .map((p) => p.message)
      .join('\n');

  it.each([
    ['an action pinned by tag', ci.replace(CHECKOUT, 'actions/checkout@v4'), /not pinned/],
    ['an action pinned by a branch', ci.replace(CHECKOUT, 'actions/checkout@main'), /not pinned/],
    ['a short SHA', ci.replace(CHECKOUT, 'actions/checkout@3d3c42e # v7.0.1'), /not pinned/],
    [
      'a SHA without the version comment',
      ci.replace(CHECKOUT, `actions/checkout@${SHA}`),
      /not pinned/,
    ],
    [
      'a checkout that keeps the token',
      ci.replace(/ {8}with:\n {10}persist-credentials: false\n/, ''),
      /persist-credentials/,
    ],
    [
      'no permissions',
      ci.replace(/^permissions:\n {2}contents: read\n/m, ''),
      /no top-level "permissions:"/,
    ],
    [
      'write-all',
      ci.replace(/^permissions:\n {2}contents: read\n/m, 'permissions: write-all\n'),
      /write-all/,
    ],
    ['a write permission', ci.replace('contents: read', 'contents: write'), /granted as write/],
    [
      'pull_request_target',
      ci.replace('  pull_request:\n', '  pull_request_target:\n'),
      /pull_request_target/,
    ],
    [
      'a branch name in a script',
      ci.replace('run: npm ci', 'run: echo ${{ github.head_ref }}'),
      /controlled by the author/,
    ],
    [
      'a PR title in a script',
      ci.replace('run: npm ci', 'run: echo "${{ github.event.pull_request.title }}"'),
      /controlled by the author/,
    ],
    [
      'a job without a timeout',
      ci.replace(/ {4}timeout-minutes: 10\n/, ''),
      /job "audit" has no timeout/,
    ],
    [
      'ubuntu-latest',
      ci.replace('runs-on: ubuntu-24.04', 'runs-on: ubuntu-latest'),
      /not ubuntu-latest/,
    ],
    ['no jobs', 'name: x\npermissions:\n  contents: read\n', /has no jobs/],
  ])('rejects %s', (_name, text, expected) => {
    expect(text).not.toBe(ci); // the edit really changed the file
    expect(messages(text)).toMatch(expected);
  });

  it('does not mistake event_name, which the author cannot set, for author-controlled text', () => {
    expect(checkWorkflow(ci, 'ci.yml').some((p) => p.message.includes('author'))).toBe(false);
    expect(ci).toContain('github.event_name');
  });

  it('reports the line of an unpinned action', () => {
    const line = ci.split('\n').findIndex((l) => CHECKOUT.test(l)) + 1;
    expect(messages(ci.replace(CHECKOUT, 'actions/checkout@v4'))).toContain(`line ${line}:`);
  });

  it('allows an action of this repository', () => {
    const text = ci.replace(CHECKOUT, '').replace(/- uses: *\n/, '');
    expect(messages(`${text}\n      - uses: ./.github/actions/x\n`)).not.toMatch(/\.\/\.github/);
  });
});

describe('checkDependabot', () => {
  const dependabot = read('.github/dependabot.yml');

  it.each(['npm', 'github-actions', 'docker', 'docker-compose'])('requires %s', (ecosystem) => {
    const without = dependabot.replace(
      new RegExp(`package-ecosystem: ${ecosystem}\\n`),
      'package-ecosystem: pip\n',
    );
    expect(without).not.toBe(dependabot);
    expect(checkDependabot(without).map((p) => p.message)).toEqual([
      `does not keep "${ecosystem}" up to date`,
    ]);
  });

  it('accepts quoted ecosystem names', () => {
    const quoted = dependabot.replace(/package-ecosystem: (\S+)/g, 'package-ecosystem: "$1"');
    expect(checkDependabot(quoted)).toEqual([]);
  });
});

describe('checkPlaywrightVersions', () => {
  const compose = read('docker-compose.e2e.yml');
  const pkg = read('package.json');

  it('rejects versions that differ', () => {
    const other = pkg.replace(/"@playwright\/test": "[^"]+"/, '"@playwright/test": "1.0.0"');
    expect(other).not.toBe(pkg);
    expect(checkPlaywrightVersions(compose, other)[0]?.message).toMatch(
      /image is 1\.\d+\.\d+ but @playwright\/test is 1\.0\.0/,
    );
  });

  it('rejects an image without a digest', () => {
    const loose = compose.replace(/@sha256:[0-9a-f]{64}/, '');
    expect(checkPlaywrightVersions(loose, pkg)[0]?.message).toMatch(/not pinned/);
  });

  it('rejects a missing @playwright/test', () => {
    const none = pkg.replace('"@playwright/test"', '"@playwright/other"');
    expect(checkPlaywrightVersions(compose, none)[0]?.message).toMatch(/is missing/);
  });
});
