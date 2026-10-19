import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from './build-server';

let dir: string;
let bundle: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'console-bundle-'));
  bundle = await buildServer(dir);
}, 60_000);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const KEY = 'bundle-test-key-0123456789abcdef';

function get(
  port: number,
  path: string,
  host: string,
): Promise<{
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, agent: false, headers: { Host: host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('the bundled server', () => {
  it('is one file with its dependencies inside it, so the runtime needs no node_modules', () => {
    const text = readFileSync(bundle, 'utf8');
    // No import of a package from node_modules (node: built-ins are part of Node itself).
    const imports = [...text.matchAll(/^\s*import\b[^;\n]*?from\s*["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    expect(imports.filter((name) => !name?.startsWith('node:'))).toEqual([]);
    expect(text).toContain('console server listening');
  });

  it('does not contain the key it will be given: it reads it when it starts', () => {
    expect(readFileSync(bundle, 'utf8')).not.toContain(KEY);
  });

  it('starts from the bundle alone, serves, never prints the key, and stops cleanly on SIGTERM', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    // Run from an empty directory with an empty PATH-independent environment: nothing but the bundle.
    const server = spawn(process.execPath, [bundle], {
      cwd: dir,
      env: {
        LEDGERD_API_KEY: KEY,
        LEDGERD_URL: 'http://127.0.0.1:9',
        CONSOLE_ADDR: `127.0.0.1:${String(port)}`,
        PATH: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    server.stdout.on('data', (c: Buffer) => {
      output += c.toString();
    });
    server.stderr.on('data', (c: Buffer) => {
      output += c.toString();
    });
    try {
      const host = `127.0.0.1:${String(port)}`;
      let health: Awaited<ReturnType<typeof get>> | undefined;
      for (let i = 0; i < 60 && health === undefined; i += 1) {
        try {
          health = await get(port, '/healthz', host);
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      expect(health?.status).toBe(200);
      expect(health?.headers['content-security-policy']).toContain("default-src 'self'");

      // ledgerd is unreachable (port 9): the console says it is not ready, and does not leak why.
      const ready = await get(port, '/readyz', host);
      expect(ready.status).toBe(503);
      expect((await get(port, '/healthz', 'evil.example')).status).toBe(421);
    } finally {
      server.kill('SIGTERM');
    }
    const [code] = (await once(server, 'exit')) as [number | null];
    expect(code).toBe(0);
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(KEY);
  }, 60_000);

  it('refuses to start without a key, saying so without printing one', async () => {
    const server = spawn(process.execPath, [bundle], {
      cwd: dir,
      env: { PATH: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    server.stderr.on('data', (c: Buffer) => {
      err += c.toString();
    });
    const [code] = (await once(server, 'exit')) as [number | null];
    expect(code).toBe(2);
    expect(err).toContain('LEDGERD_API_KEY is required');
  }, 30_000);
});
