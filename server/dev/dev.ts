import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { devEnvironment, WEB_PORT } from './dev-env';

/*
 * `npm run dev`: the console server (restarted when its code changes) and Vite, together,
 * with each one's output prefixed. Stopping either stops both.
 */

const environment = devEnvironment(process.env);
if (!environment.ok) {
  process.stderr.write(
    `ledgerd-console: cannot start\n${environment.errors.map((e) => `  - ${e}`).join('\n')}\n`,
  );
  process.exit(2);
}

const bin = (...parts: string[]): string => join(process.cwd(), 'node_modules', ...parts);
const tsx = bin('tsx', 'dist', 'cli.mjs');
const vite = bin('vite', 'bin', 'vite.js');
for (const file of [tsx, vite]) {
  if (!existsSync(file)) {
    process.stderr.write(`ledgerd-console: ${file} not found; run "npm ci" first\n`);
    process.exit(2);
  }
}

const children: ChildProcess[] = [];
let stopping = false;
let exitCode = 0;

function run(name: string, script: string, args: string[], env: Record<string, string>): void {
  const child = spawn(process.execPath, [script, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const prefix = (stream: NodeJS.ReadableStream, out: NodeJS.WritableStream): void => {
    createInterface({ input: stream }).on('line', (line) => out.write(`[${name}] ${line}\n`));
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (!stopping) {
      process.stderr.write(
        `[dev] ${name} stopped (${signal ?? String(code)}); stopping the other\n`,
      );
      exitCode = code ?? 1;
      stop();
    }
  });
}

function stop(): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  // Do not wait forever for a child that ignores SIGTERM.
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 5000).unref();
  const remaining = children.filter((c) => c.exitCode === null && c.signalCode === null);
  if (remaining.length === 0) process.exit(exitCode);
  let waiting = remaining.length;
  for (const child of remaining) {
    child.once('exit', () => {
      waiting -= 1;
      if (waiting === 0) process.exit(exitCode);
    });
  }
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

process.stdout.write(`[dev] open http://localhost:${String(WEB_PORT)}\n`);
run('server', tsx, ['watch', 'server/src/main.ts'], environment.server);
run('web', vite, [], environment.web);
