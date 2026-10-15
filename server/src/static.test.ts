import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { captureLogger, send, testConfig } from './testkit';

const INDEX = '<!doctype html><title>console</title><div id="root"></div>';
let dir: string;
let outside: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'console-static-'));
  outside = await mkdtemp(join(tmpdir(), 'console-outside-'));
  await mkdir(join(dir, 'dist', 'assets'), { recursive: true });
  await writeFile(join(dir, 'dist', 'index.html'), INDEX);
  await writeFile(join(dir, 'dist', 'assets', 'app-3fa9c1.js'), 'console.log("app")');
  await writeFile(join(dir, 'dist', 'assets', 'app-3fa9c1.css'), 'body{margin:0}');
  await writeFile(join(dir, 'dist', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(dir, 'dist', '.env'), 'LEDGERD_API_KEY=should-never-be-served');
  await writeFile(join(outside, 'secret.txt'), 'outside the web root');
  await symlink(outside, join(dir, 'dist', 'link-out'));
  await symlink(join(outside, 'secret.txt'), join(dir, 'dist', 'secret-link.txt'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function build(staticDir = join(dir, 'dist')) {
  return createApp({
    config: testConfig({ staticDir }),
    logger: captureLogger().logger,
    checkLedgerd: () => Promise.resolve(true),
  });
}

describe('serving the application', () => {
  it('serves index.html at the root, to be revalidated every time', async () => {
    const response = await send(build(), '/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  it.each([
    ['/assets/app-3fa9c1.js', 'text/javascript; charset=utf-8', 'console.log("app")'],
    ['/assets/app-3fa9c1.css', 'text/css; charset=utf-8', 'body{margin:0}'],
    ['/favicon.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ])('serves %s as %s', async (path, type, content) => {
    const response = await send(build(), path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(type);
    expect(await response.text()).toBe(content);
    expect(response.headers.get('Content-Length')).toBe(String(content.length));
  });

  it('caches hashed assets for a year, and nothing else', async () => {
    const app = build();
    expect((await send(app, '/assets/app-3fa9c1.js')).headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect((await send(app, '/favicon.svg')).headers.get('Cache-Control')).toBe('no-cache');
  });

  it('answers a conditional request with 304', async () => {
    const app = build();
    const first = await send(app, '/');
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^W\//);
    const again = await send(app, '/', { headers: { 'If-None-Match': etag ?? '' } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect((await send(app, '/', { headers: { 'If-None-Match': 'W/"other"' } })).status).toBe(200);
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await send(build(), '/assets/app-3fa9c1.js', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('18');
    expect(await response.text()).toBe('');
  });

  it('keeps the security headers on files', async () => {
    const response = await send(build(), '/');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('page routes (single-page fallback)', () => {
  it.each([
    '/accounts',
    '/accounts/3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11',
    '/lab',
    '/settings/',
    '/a/b/c/d',
  ])('gives %s the application, so deep links and reloads work', async (path) => {
    const response = await send(build(), path);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  it.each([
    '/assets/missing-123.js',
    '/assets/anything',
    '/assets',
    '/assets/',
    '/missing.js',
    '/missing.css',
    '/sub/dir/missing.png',
    '/robots.txt',
    '/favicon.ico',
  ])('answers 404, not HTML, for the missing file %s', async (path) => {
    const response = await send(build(), path);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/problem+json');
  });

  it('never gives the application to an unknown /api path', async () => {
    const app = build();
    for (const path of ['/api', '/api/', '/api/unknown', '/api/v1/nothing']) {
      const response = await send(app, path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain('<div id="root">');
    }
  });

  it('does not serve pages for methods other than GET and HEAD', async () => {
    const response = await send(build(), '/accounts', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('nothing outside the web root is served', () => {
  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/assets/../../secret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%2fsecret.txt',
    '/assets/..%5c..%5csecret.txt',
    '/%00',
    '/index.html%00.js',
    '/%',
    '/%E0%A4%A',
  ])('refuses %s', async (path) => {
    const response = await send(build(), path);
    expect(response.status, path).toBe(404);
    expect(await response.text(), path).not.toContain('outside the web root');
  });

  it('lets the URL parser resolve dot segments, and what is left is only ever a page route', async () => {
    // %2e%2e is a dot segment: /%2e%2e/%2e%2e/etc/passwd is /etc/passwd before we see it,
    // which is a page route of the application, not a file on disk.
    const response = await send(build(), '/%2E%2E/%2E%2E/etc/passwd');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  it('does not serve dotfiles: .env, .git', async () => {
    for (const path of ['/.env', '/.git/config', '/assets/.hidden', '/.well-known/x']) {
      const response = await send(build(), path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain('should-never-be-served');
    }
  });

  it('does not follow a symbolic link that leads out of the root', async () => {
    for (const path of ['/secret-link.txt', '/link-out/secret.txt']) {
      const response = await send(build(), path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain('outside the web root');
    }
  });
});

describe('before the application is built', () => {
  it('says what to do, for the application routes only', async () => {
    const app = build(join(dir, 'does-not-exist'));
    const page = await send(app, '/accounts');
    expect(page.status).toBe(404);
    expect(JSON.stringify(await page.json())).toContain('npm run build');
    expect((await send(app, '/healthz')).status).toBe(200); // the API and probes work regardless
  });

  it('finds the build once it exists, without a restart', async () => {
    const late = await mkdtemp(join(tmpdir(), 'console-late-'));
    const root = join(late, 'dist');
    const app = build(root);
    expect((await send(app, '/')).status).toBe(404);
    await mkdir(root);
    await writeFile(join(root, 'index.html'), INDEX);
    expect((await send(app, '/')).status).toBe(200);
    await rm(late, { recursive: true, force: true });
  });

  it('is 404 when the build has no index.html', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'console-empty-'));
    expect((await send(build(empty), '/accounts')).status).toBe(404);
    await rm(empty, { recursive: true, force: true });
  });
});
