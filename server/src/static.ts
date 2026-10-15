import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { Readable } from 'node:stream';

import type { Context } from 'hono';

import type { AppEnv } from './app';
import { problemResponse } from './problem';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/**
 * Serves the built web application from `root`.
 *
 * - A path that names a file is served as that file. Files under `/assets/` carry a content
 *   hash in their name, so they are cached for a year; everything else must be revalidated,
 *   so a new build is picked up at once.
 * - A path that is not a file but looks like a page (`/accounts/…`) gets `index.html`, so
 *   deep links and reloads work in a single-page application.
 * - A path that looks like a file, or is under `/assets/`, and does not exist is a `404`.
 *   Answering it with HTML would make a missing script fail with a baffling syntax error.
 * - Nothing outside `root` is ever served: no `..`, no encoded separators, no dotfiles, no
 *   symbolic link that leads out.
 */
export function staticFiles(root: string) {
  let realRoot: Promise<string | undefined> | undefined;
  const resolveRoot = (): Promise<string | undefined> => {
    // Looked up on each request until it exists, so a build made after the server started
    // (development) is found.
    realRoot ??= realpath(root).catch(() => {
      realRoot = undefined;
      return undefined;
    });
    return realRoot;
  };

  return async (c: Context<AppEnv>): Promise<Response> => {
    const miss = (): Response => problemResponse(c, 404, 'not_found', 'Not found');

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return miss();
    }
    if (pathname.includes('\0') || pathname.includes('\\')) return miss();

    const segments = pathname.split('/').filter((s) => s !== '');
    if (segments.some((s) => s.startsWith('.'))) return miss(); // '..', '.', '.env', '.git'

    const base = await resolveRoot();
    if (base === undefined) return notBuilt(c);

    const found = segments.length > 0 ? await fileAt(base, join(base, ...segments)) : undefined;
    if (found !== undefined) {
      return serve(c, found.path, found.size, found.mtimeMs, segments[0] === 'assets');
    }

    const last = segments.at(-1) ?? '';
    if (segments[0] === 'assets' || /\.[A-Za-z0-9]+$/.test(last)) return miss();

    const index = await fileAt(base, join(base, 'index.html'));
    if (index === undefined) return notBuilt(c);
    return serve(c, index.path, index.size, index.mtimeMs, false);
  };
}

interface Found {
  path: string;
  size: number;
  mtimeMs: number;
}

/** The regular file at `candidate`, if it exists and really lives inside `base`. */
async function fileAt(base: string, candidate: string): Promise<Found | undefined> {
  try {
    const real = await realpath(candidate);
    if (!real.startsWith(base + sep)) return undefined;
    const info = await stat(real);
    return info.isFile() ? { path: real, size: info.size, mtimeMs: info.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

function serve(
  c: Context<AppEnv>,
  path: string,
  size: number,
  mtimeMs: number,
  immutable: boolean,
): Response {
  const etag = `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
  const headers = new Headers({
    'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': immutable ? IMMUTABLE : REVALIDATE,
    ETag: etag,
  });
  if (c.req.header('If-None-Match') === etag) return new Response(null, { status: 304, headers });

  headers.set('Content-Length', String(size));
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
}

function notBuilt(c: Context<AppEnv>): Response {
  return problemResponse(
    c,
    404,
    'not_found',
    'Not found',
    'The web application has not been built here. Run "npm run build", or use "npm run dev".',
  );
}
