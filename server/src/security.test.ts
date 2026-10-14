import { describe, expect, it } from 'vitest';

import { createApp, DEFAULT_LIMITS } from './app';
import { CONTENT_SECURITY_POLICY } from './security';
import { captureLogger, CONSOLE_HEADERS, send, testConfig, withHost } from './testkit';

function build(options: { now?: () => number; limits?: Partial<typeof DEFAULT_LIMITS> } = {}) {
  const log = captureLogger();
  const app = createApp({
    config: testConfig(),
    logger: log.logger,
    checkLedgerd: () => Promise.resolve(true),
    ...options,
  });
  // A route that echoes, so we can tell "reached the handler" from "refused earlier".
  app.post('/api/echo', (c) => c.json({ reached: true }));
  app.get('/api/echo', (c) => c.json({ reached: true }));
  return { app, log };
}

const json = { 'Content-Type': 'application/json' };
const post = (app: ReturnType<typeof build>['app'], headers: Record<string, string>, body = '{}') =>
  send(app, '/api/echo', { method: 'POST', headers, body });

async function code(response: Response): Promise<string> {
  return ((await response.json()) as { code: string }).code;
}

describe('Host check (DNS rebinding)', () => {
  const { app } = build();

  it.each(['localhost:8787', '127.0.0.1:8787', 'LOCALHOST:8787'])(
    'serves the host %s',
    async (host) => {
      expect((await send(app, '/healthz', { headers: { Host: host } })).status).toBe(200);
    },
  );

  it.each([
    'evil.example:8787',
    'localhost:9999',
    'localhost',
    'localhost.:8787',
    '127.0.0.1',
    'evil.example',
    '[::1]:8787',
  ])('refuses the host %s with 421', async (host) => {
    const response = await send(app, '/healthz', { headers: { Host: host } });
    expect(response.status).toBe(421);
    expect(await code(response)).toBe('misdirected_request');
  });

  it('refuses a request with no Host header', async () => {
    const response = await app.request('/healthz'); // no Host: not through send()
    expect(response.status).toBe(421);
  });

  it('protects every path, not only the API', async () => {
    for (const path of [
      '/',
      '/healthz',
      '/readyz',
      '/assets/app.js',
      '/api/v1/accounts',
      '/accounts/123',
    ]) {
      expect((await send(app, path, { headers: { Host: 'evil.example:8787' } })).status, path).toBe(
        421,
      );
    }
  });
});

describe('cross-site request forgery', () => {
  const { app } = build();

  it('lets the console itself through', async () => {
    const response = await post(app, {
      ...json,
      ...CONSOLE_HEADERS,
      'Sec-Fetch-Site': 'same-origin',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reached: true });
  });

  it('lets through a state-changing call from a non-browser client that sends the header and no Origin', async () => {
    expect((await post(app, { ...json, 'X-Ledgerd-Console': '1' })).status).toBe(200);
  });

  it('refuses a POST without the console header, even from an allowed origin', async () => {
    const response = await post(app, { ...json, Origin: 'http://localhost:8787' });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('forbidden');
  });

  it('refuses a POST with the wrong value in the console header', async () => {
    expect((await post(app, { ...json, 'X-Ledgerd-Console': '0' })).status).toBe(403);
    expect((await post(app, { ...json, 'X-Ledgerd-Console': 'true' })).status).toBe(403);
  });

  it('refuses a POST from another origin, even if it knows the header', async () => {
    const response = await post(app, {
      ...json,
      'X-Ledgerd-Console': '1',
      Origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
  });

  it.each([
    'null',
    'http://localhost:9999',
    'http://localhost:8787.evil.example',
    'https://localhost:8787',
  ])('refuses the origin %s', async (origin) => {
    expect((await post(app, { ...json, 'X-Ledgerd-Console': '1', Origin: origin })).status).toBe(
      403,
    );
  });

  it.each(['cross-site', 'same-site', 'none'])('refuses Sec-Fetch-Site: %s', async (site) => {
    expect((await post(app, { ...json, ...CONSOLE_HEADERS, 'Sec-Fetch-Site': site })).status).toBe(
      403,
    );
  });

  it('applies to every state-changing method', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await send(app, '/api/echo', {
        method,
        headers: json,
        ...(method === 'DELETE' ? {} : { body: '{}' }),
      });
      expect(response.status, method).toBe(403);
    }
  });

  it('does not require the header for reads', async () => {
    expect((await send(app, '/api/echo')).status).toBe(200);
  });

  it('does not apply to the console server own probes or pages', async () => {
    expect((await send(app, '/healthz')).status).toBe(200);
  });
});

describe('request body limits', () => {
  const { app } = build();
  const headers = { ...json, ...CONSOLE_HEADERS };

  it('accepts a body at the limit', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(DEFAULT_LIMITS.maxBodyBytes - 10) });
    expect(body.length).toBe(DEFAULT_LIMITS.maxBodyBytes);
    expect(
      (await post(app, { ...headers, 'Content-Length': String(body.length) }, body)).status,
    ).toBe(200);
  });

  it('refuses a declared length over the limit before reading the body', async () => {
    const response = await post(
      app,
      { ...headers, 'Content-Length': String(DEFAULT_LIMITS.maxBodyBytes + 1) },
      '{}',
    );
    expect(response.status).toBe(413);
    expect(await code(response)).toBe('payload_too_large');
  });

  it('refuses an undeclared body that turns out to be too large', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(DEFAULT_LIMITS.maxBodyBytes) });
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    // The app reads the body in a handler that needs it; here the limit middleware does.
    const sized = build();
    sized.app.post('/api/read', async (c) => c.json({ length: (await c.req.text()).length }));
    const response = await send(sized.app, '/api/read', {
      method: 'POST',
      headers,
      body: streamed,
      duplex: 'half',
    });
    expect(response.status).toBe(413);
  });

  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    '',
  ])('refuses a body with content type %j', async (type) => {
    const h: Record<string, string> = { ...CONSOLE_HEADERS };
    if (type !== '') h['Content-Type'] = type;
    const response = await post(app, h, 'a=1');
    expect(response.status).toBe(415);
    expect(await code(response)).toBe('unsupported_media_type');
  });

  it('accepts JSON with a charset', async () => {
    expect(
      (await post(app, { ...CONSOLE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }))
        .status,
    ).toBe(200);
  });

  it('lets a request with no body through without a content type (reverse, reconcile)', async () => {
    expect(
      (await send(app, '/api/echo', { method: 'POST', headers: CONSOLE_HEADERS })).status,
    ).toBe(200);
  });
});

describe('rate limiting', () => {
  it('lets a burst through and then answers 429 with Retry-After', async () => {
    let now = 0;
    const { app } = build({ now: () => now, limits: { ratePerSecond: 10, burst: 20 } });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) statuses.push((await send(app, '/healthz')).status);

    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);

    const refused = await send(app, '/healthz');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(await code(refused)).toBe('too_many_requests');

    now += 5000; // the bucket refills
    expect((await send(app, '/healthz')).status).toBe(200);
  });

  it('is generous enough for the Failure Lab: 100 requests at once are all served', async () => {
    const { app } = build();
    const responses = await Promise.all(Array.from({ length: 100 }, () => send(app, '/api/echo')));
    expect(responses.every((r) => r.status === 200)).toBe(true);
  });

  it('is applied after the Host check, so a refused host does not use the bucket', async () => {
    const now = 0;
    const { app } = build({ now: () => now, limits: { ratePerSecond: 1, burst: 1 } });
    await send(app, '/healthz', { headers: { Host: 'evil.example:8787' } });
    expect((await send(app, '/healthz')).status).toBe(200); // the one token is still there
  });
});

describe('security headers', () => {
  const { app } = build();
  const expected = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };

  const cases: [string, () => Promise<Response>][] = [
    ['a success', () => send(app, '/healthz')],
    ['a 404', () => send(app, '/nothing')],
    [
      'a host refusal (421)',
      () => send(app, '/healthz', { headers: { Host: 'evil.example:8787' } }),
    ],
    [
      'a forgery refusal (403)',
      () => send(app, '/api/echo', { method: 'POST', headers: json, body: '{}' }),
    ],
    [
      'a size refusal (413)',
      () =>
        send(app, '/api/echo', {
          method: 'POST',
          headers: { ...json, ...CONSOLE_HEADERS, 'Content-Length': '999999' },
          body: '{}',
        }),
    ],
  ];
  it.each(cases)('are on %s', async (_name, call) => {
    const response = await call();
    for (const [name, value] of Object.entries(expected))
      expect(response.headers.get(name), name).toBe(value);
  });

  it('the policy forbids inline code and outside sources', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it('API answers are never cached', async () => {
    expect((await send(app, '/api/echo')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('nothing reveals the server software', async () => {
    const response = await send(app, '/healthz');
    expect(response.headers.get('Server')).toBeNull();
    expect(response.headers.get('X-Powered-By')).toBeNull();
  });
});

describe('the pipeline does not need a route to protect it', () => {
  it('refuses a forged POST to a path that does not exist before saying 404', async () => {
    const { app } = build();
    const response = await send(app, '/api/v1/accounts', {
      method: 'POST',
      headers: json,
      body: '{}',
    });
    expect(response.status).toBe(403);
  });

  it('keeps working through withHost', async () => {
    const { app } = build();
    expect((await withHost(app).request('/healthz')).status).toBe(200);
  });
});
