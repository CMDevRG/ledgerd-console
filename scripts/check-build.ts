/*
 * Checks what the build produced. Run by `npm run verify` after `npm run build`.
 *
 *   1. The page and its files satisfy the Content Security Policy (no inline script or style).
 *   2. The browser bundle has no code that builds an Authorization header.
 *   3. The API key is in no emitted file. This is proven, not assumed: a throwaway build is made
 *      with a random canary key in the environment (under every name a build might pick it up
 *      by), and the canary is searched for in everything that build emitted. The scanner is
 *      first shown a file that does contain the canary, so a scanner that has gone blind fails.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { buildServer } from './build-server';
import {
  checkClientBundle,
  checkHtml,
  findSecret,
  isEmittedText,
  type OutputFile,
  type Problem,
} from './build-checks';

function listFiles(root: string): OutputFile[] {
  const out: OutputFile[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ path: relative(process.cwd(), full), content: readFileSync(full) });
    }
  };
  walk(root);
  return out;
}

/** The names under which a build tool or the code might pick the key up from the environment. */
const KEY_NAMES = [
  'LEDGERD_API_KEY',
  'VITE_LEDGERD_API_KEY',
  'VITE_API_KEY',
  'API_KEY',
  'CONSOLE_API_KEY',
];

async function canaryBuild(canary: string, scratch: string): Promise<OutputFile[]> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of KEY_NAMES) env[name] = canary;

  const clientOut = join(scratch, 'dist');
  const vite = spawnSync(
    process.execPath,
    [
      join('node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--outDir',
      clientOut,
      '--emptyOutDir',
      '--logLevel',
      'error',
    ],
    { env, encoding: 'utf8' },
  );
  if (vite.status !== 0)
    throw new Error(`the throwaway client build failed:\n${vite.stdout}${vite.stderr}`);

  // The server is bundled in this process, so the canary must be in this process's environment.
  const saved = KEY_NAMES.map((name) => [name, process.env[name]] as const);
  for (const name of KEY_NAMES) process.env[name] = canary;
  const serverOut = join(scratch, 'dist-server');
  try {
    await buildServer(serverOut);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  }
  return [...listFiles(clientOut), ...listFiles(serverOut)];
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: 'dist' },
      'skip-canary': { type: 'boolean', default: false },
    },
  });
  const problems: Problem[] = [];

  // 1 and 2: the real build.
  const client = listFiles(values.dist);
  for (const file of client.filter((f) => f.path.endsWith('.html'))) {
    problems.push(...checkHtml(file.content.toString('utf8'), file.path));
  }
  problems.push(...checkClientBundle(client));
  if (!client.some((f) => f.path.endsWith('index.html'))) {
    problems.push({ file: values.dist, message: 'has no index.html: run npm run build first' });
  }

  // 3: the canary.
  let scanned = 0;
  if (!values['skip-canary']) {
    const canary = `canary-${randomBytes(18).toString('hex')}`;
    const blind = findSecret(
      [{ path: 'self-test', content: Buffer.from(`x ${canary} y`) }],
      canary,
    );
    if (blind.length === 0)
      problems.push({
        file: 'scripts/build-checks.ts',
        message: 'the scanner did not find a canary it was shown',
      });

    const scratch = mkdtempSync(join(tmpdir(), 'console-canary-'));
    try {
      const emitted = (await Promise.resolve(canaryBuild(canary, scratch))).filter((f) =>
        isEmittedText(f.path),
      );
      scanned = emitted.length;
      if (scanned === 0)
        problems.push({ file: scratch, message: 'the throwaway build emitted nothing to scan' });
      problems.push(...findSecret(emitted, canary));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  if (problems.length > 0) {
    process.stderr.write('check-build found problems:\n');
    for (const p of problems) process.stderr.write(`  - ${p.file}: ${p.message}\n`);
    return 1;
  }
  process.stdout.write(
    `check-build: ${String(client.length)} files in ${values.dist} satisfy the policy and hold no credential code` +
      (values['skip-canary']
        ? '.\n'
        : `; the canary key is in none of the ${String(scanned)} files of a throwaway build.\n`),
  );
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    process.stderr.write(
      `check-build: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  },
);
