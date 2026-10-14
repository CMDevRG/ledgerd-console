import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { captureLogger, testConfig, TEST_KEY } from './testkit';

function build(ready: () => Promise<boolean> = () => Promise.resolve(true)) {
  const log = captureLogger();
  const app = createApp({ config: testConfig(), logger: log.logger, checkLedgerd: ready });
  return { app, log };
}

describe('health endpoints', () => {
  it('/healthz says the process is up, whatever ledgerd is doing', async () => {
    const { app } = build(() => Promise.resolve(false));
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('/readyz is ready when ledgerd is', async () => {
    const response = await build().app.request('/readyz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
  });

  it.each<[string, () => Promise<boolean>]>([
    ['says it is not ready', () => Promise.resolve(false)],
    ['throws', () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:8085'))],
  ])('/readyz is 503 with a problem document when the check %s', async (_name, check) => {
    const { app } = build(check);
    const response = await app.request('/readyz');
    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json');
    expect(response.headers.get('Retry-After')).toBe('1');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'not_ready', status: 503 });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/); // the cause is not shown
  });
});

describe('request ids', () => {
  it('generates one when none is offered', async () => {
    const a = (await build().app.request('/healthz')).headers.get('X-Request-Id');
    const b = (await build().app.request('/healthz')).headers.get('X-Request-Id');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('keeps a well-formed id from the client', async () => {
    const response = await build().app.request('/healthz', {
      headers: { 'X-Request-Id': 'trace-1.a_B' },
    });
    expect(response.headers.get('X-Request-Id')).toBe('trace-1.a_B');
  });

  it.each(['has space', 'semi;colon', 'new\nline', 'a'.repeat(65), 'ünï', '<script>'])(
    'replaces a malformed id (%j) by a safe one',
    async (bad) => {
      const response = await build().app.request('/healthz', {
        headers: { 'X-Request-Id': encodeURIComponentSafe(bad) },
      });
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f]{32}$|^[A-Za-z0-9._-]{1,64}$/);
    },
  );

  it('puts the id in error documents', async () => {
    const response = await build().app.request('/nothing-here', {
      headers: { 'X-Request-Id': 'abc-1' },
    });
    expect(await response.json()).toMatchObject({
      code: 'not_found',
      request_id: 'abc-1',
      instance: '/nothing-here',
    });
  });
});

// Header values cannot carry raw control characters through fetch, so those are
// exercised by percent-encoding what a client would try to send.
function encodeURIComponentSafe(value: string): string {
  return /[^\x20-\x7e]/.test(value) ? encodeURIComponent(value) : value;
}

describe('logging', () => {
  it('writes one line per request with the fields an operator needs', async () => {
    const { app, log } = build();
    await app.request('/healthz?token=do-not-log', {
      headers: { 'X-Request-Id': 'log-1', Authorization: 'Bearer client-secret' },
    });
    const lines = log.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'request',
      request_id: 'log-1',
      method: 'GET',
      path: '/healthz',
      status: 200,
    });
    expect(typeof lines[0]?.duration_ms).toBe('number');
  });

  it('never logs query strings, headers, or the API key', async () => {
    const { app, log } = build();
    await app.request('/healthz?token=do-not-log', {
      headers: { Authorization: 'Bearer client-secret', Cookie: 'sid=abc' },
    });
    const text = log.raw();
    for (const leak of ['do-not-log', 'client-secret', 'sid=abc', TEST_KEY])
      expect(text).not.toContain(leak);
  });
});

describe('unexpected failures', () => {
  it('become a generic 500; the cause is logged, never returned', async () => {
    const log = captureLogger();
    const app = createApp({
      config: testConfig(),
      logger: log.logger,
      checkLedgerd: () => Promise.resolve(true),
    });
    app.get('/boom', () => {
      throw new Error('relation "accounts" does not exist at /srv/app/db.js:42 password=hunter2');
    });

    const response = await app.request('/boom', { headers: { 'X-Request-Id': 'boom-1' } });
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('internal_error');
    expect(text).not.toMatch(/relation|accounts|srv|hunter2/);

    const errorLine = log.lines().find((l) => l.level === 'error');
    expect(errorLine).toMatchObject({ request_id: 'boom-1' });
    expect(String(errorLine?.error)).toContain('relation');
    // The access line still records the real status.
    expect(log.lines().find((l) => l.msg === 'request')).toMatchObject({ status: 500 });
  });
});

describe('unknown paths', () => {
  it('answer 404 as a problem document', async () => {
    const response = await build().app.request('/no/such/thing');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({
      type: 'urn:ledgerd-console:error:not_found',
      status: 404,
    });
  });
});
