import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-build-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const GOOD =
  '<!doctype html><html><head><script type="module" src="/assets/a.js"></script></head><body><div id="root"></div></body></html>';

function site(name: string, files: Record<string, string>): string {
  const out = join(dir, name);
  mkdirSync(join(out, 'assets'), { recursive: true });
  for (const [path, content] of Object.entries(files)) writeFileSync(join(out, path), content);
  return out;
}

function check(dist: string) {
  // --skip-canary: the throwaway build is slow and is exercised by `npm run check:build` itself.
  const r = spawnSync(
    process.execPath,
    [tsx, join(root, 'scripts', 'check-build.ts'), '--dist', dist, '--skip-canary'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Each test starts Node and compiles TypeScript.
describe('check-build (the command)', { timeout: 60_000 }, () => {
  it('passes a build whose page satisfies the policy and whose code builds no credential', () => {
    const result = check(
      site('good', { 'index.html': GOOD, 'assets/a.js': 'fetch("/api/readyz")' }),
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain('satisfy the policy');
  });

  it('fails a page with an inline script, naming the file and the problem', () => {
    const result = check(
      site('inline', { 'index.html': `${GOOD}<script>steal()</script>`, 'assets/a.js': '' }),
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('an inline script');
    expect(result.err).toMatch(/inline[\\/]index\.html|index\.html/);
  });

  it('fails browser code that builds an Authorization header', () => {
    const result = check(
      site('auth', { 'index.html': GOOD, 'assets/a.js': 'h.set("Authorization","Bearer "+k)' }),
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('Bearer');
  });

  it('fails when there is no build to check', () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const result = check(empty);
    expect(result.code).toBe(1);
    expect(result.err).toContain('has no index.html');
  });

  it('fails when the folder is missing, with a message and not a stack trace', () => {
    const result = check(join(dir, 'missing'));
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/check-build: /);
  });
});
