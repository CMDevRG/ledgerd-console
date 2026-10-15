import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { rewriteLocation } from './forward';
import { ROUTES } from './routes';
import {
  captureLogger,
  CONSOLE_HEADERS,
  send,
  startFakeLedgerd,
  testConfig,
  TEST_KEY,
  type FakeLedgerd,
} from './testkit';

const ID = '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11';
const json = { 'Content-Type': 'application/json' };
const write = { ...json, ...CONSOLE_HEADERS };

let respond: Parameters<typeof startFakeLedgerd>[0];

// One fake ledgerd for the file; each test says how it answers.
const ledgerd: FakeLedgerd = await startFakeLedgerd((request, response) => {
  if (respond) respond(request, response);
  else response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
});
afterAll(async () => {
  await ledgerd.close();
});
beforeEach(() => {
  respond = undefined;
  ledgerd.requests.length = 0;
});

function build(overrides: { ledgerdUrl?: URL; forwardTimeoutMs?: number } = {}) {
  const log = captureLogger();
  const app = createApp({
    config: testConfig({ ledgerdUrl: overrides.ledgerdUrl ?? ledgerd.url }),
    logger: log.logger,
    checkLedgerd: () => Promise.resolve(true),
    ...(overrides.forwardTimeoutMs !== undefined
      ? { forwardTimeoutMs: overrides.forwardTimeoutMs }
      : {}),
  });
  return { app, log };
}

describe('what is forwarded where', () => {
  it.each(ROUTES.map((r) => [r.method, r.path] as const))(
    '%s %s reaches ledgerd at the same path',
    async (method, path) => {
      const { app } = build();
      const browserPath = `/api${path.replace('{id}', ID)}`;
      const response = await send(app, browserPath, {
        method,
        headers: method === 'GET' ? {} : write,
        ...(method === 'POST' && path !== '/v1/reconciliations' && !path.endsWith('/reverse')
          ? { body: '{}' }
          : {}),
      });
      expect(response.status).toBe(200);
      expect(ledgerd.requests).toHaveLength(1);
      expect(ledgerd.requests[0]).toMatchObject({ method, url: path.replace('{id}', ID) });
    },
  );

  it('forwards the query string unchanged', async () => {
    const { app } = build();
    await send(app, `/api/v1/accounts/${ID}/balance?as_of=2026-10-01T10%3A00%3A00.5Z&x=a+b`);
    expect(ledgerd.requests[0]?.url).toBe(
      `/v1/accounts/${ID}/balance?as_of=2026-10-01T10%3A00%3A00.5Z&x=a+b`,
    );
  });

  it('forwards the body byte for byte, with amounts as strings', async () => {
    const { app } = build();
    const body = '{"postings":[{"amount":"1000000000000000000000000000000"}], "pad" : 1}';
    await send(app, '/api/v1/transactions', { method: 'POST', headers: write, body });
    expect(ledgerd.requests[0]?.body).toBe(body);
  });

  it('does not contact ledgerd for anything outside the allow-list', async () => {
    const { app } = build();
    for (const [method, path] of [
      ['GET', '/api/healthz'],
      ['GET', '/api/v1/admin'],
      ['GET', '/api/'],
      ['GET', '/api/v1/accounts/..%2F..%2Fhealthz'],
      ['GET', '/api/v1/accounts/%2e%2e'],
      ['GET', '/api/v1/../healthz'],
    ] as const) {
      const response = await send(app, path, { method });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(ledgerd.requests).toHaveLength(0);
  });

  it('answers 405 with Allow, without contacting ledgerd', async () => {
    const { app } = build();
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const response = await send(app, `/api/v1/accounts/${ID}`, {
        method,
        headers: CONSOLE_HEADERS,
      });
      expect(response.status, method).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
    }
    const post = await send(app, `/api/v1/accounts/${ID}`, {
      method: 'POST',
      headers: write,
      body: '{}',
    });
    expect(post.status).toBe(405);
    expect(ledgerd.requests).toHaveLength(0);
  });
});

describe('what ledgerd is told', () => {
  it('the API key is added by the server, and a key sent by the browser is ignored', async () => {
    const { app } = build();
    await send(app, '/api/v1/accounts', {
      headers: { Authorization: 'Bearer the-browser-should-not-be-able-to-choose' },
    });
    expect(ledgerd.requests[0]?.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  it('passes the idempotency key and a well-formed request id', async () => {
    const { app } = build();
    const response = await send(app, '/api/v1/transactions', {
      method: 'POST',
      headers: { ...write, 'Idempotency-Key': 'key-1', 'X-Request-Id': 'trace-9' },
      body: '{}',
    });
    expect(ledgerd.requests[0]?.headers).toMatchObject({
      'idempotency-key': 'key-1',
      'x-request-id': 'trace-9',
      'content-type': 'application/json',
    });
    expect(response.headers.get('X-Request-Id')).toBe('trace-9');
  });

  it('drops everything else a browser sends: cookies, origin, referer, forwarding and fetch metadata', async () => {
    const { app } = build();
    await send(app, '/api/v1/accounts', {
      headers: {
        Cookie: 'sid=abc',
        Origin: 'http://localhost:8787',
        Referer: 'http://localhost:8787/accounts',
        'X-Forwarded-For': '10.1.2.3',
        Forwarded: 'for=10.1.2.3',
        'X-Real-IP': '10.1.2.3',
        'X-Ledgerd-Console': '1',
        'Sec-Fetch-Site': 'same-origin',
        'Proxy-Authorization': 'Basic abc',
        'X-Custom-Secret': 'leak-me',
      },
    });
    const names = Object.keys(ledgerd.requests[0]?.headers ?? {});
    for (const forbidden of [
      'cookie',
      'origin',
      'referer',
      'x-forwarded-for',
      'forwarded',
      'x-real-ip',
      'x-ledgerd-console',
      'proxy-authorization',
      'x-custom-secret',
    ]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(ledgerd.requests[0]?.headers)).not.toMatch(/sid=abc|10\.1\.2\.3|leak-me/);
  });

  it('sends no body and no content type for a call without one', async () => {
    const { app } = build();
    await send(app, `/api/v1/transactions/${ID}/reverse`, {
      method: 'POST',
      headers: { ...CONSOLE_HEADERS, 'Idempotency-Key': 'r1' },
    });
    expect(ledgerd.requests[0]).toMatchObject({ body: '' });
    expect(ledgerd.requests[0]?.headers['content-type']).toBeUndefined();
  });
});

describe('what the browser is told', () => {
  it('relays status, body and the documented headers, and nothing else', async () => {
    respond = (_request, response) => {
      response
        .writeHead(409, {
          'Content-Type': 'application/problem+json',
          'Idempotent-Replayed': 'true',
          'Retry-After': '3',
          Allow: 'GET, POST',
          'Set-Cookie': 'session=stolen; Path=/',
          Server: 'ledgerd-internal/9.9',
          'X-Powered-By': 'secret-framework',
          'X-Debug-Auth': `Bearer ${TEST_KEY}`,
          'X-Internal-Host': 'db-primary.internal',
          'Strict-Transport-Security': 'max-age=1',
          'Access-Control-Allow-Origin': '*',
        })
        .end(
          '{"type":"urn:ledgerd:error:already_reversed","title":"Transaction already reversed","status":409,"code":"already_reversed"}',
        );
    };
    const response = await send(build().app, `/api/v1/transactions/${ID}/reverse`, {
      method: 'POST',
      headers: { ...CONSOLE_HEADERS, 'Idempotency-Key': 'r1' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'already_reversed' });
    expect(response.headers.get('Content-Type')).toBe('application/problem+json');
    expect(response.headers.get('Idempotent-Replayed')).toBe('true');
    expect(response.headers.get('Retry-After')).toBe('3');
    expect(response.headers.get('Allow')).toBe('GET, POST');

    for (const dropped of [
      'Set-Cookie',
      'Server',
      'X-Powered-By',
      'X-Debug-Auth',
      'X-Internal-Host',
      'Strict-Transport-Security',
      'Access-Control-Allow-Origin',
    ]) {
      expect(response.headers.get(dropped), dropped).toBeNull();
    }
  });

  it('puts the /api prefix back on Location', async () => {
    respond = (_request, response) => {
      response
        .writeHead(201, { 'Content-Type': 'application/json', Location: `/v1/transactions/${ID}` })
        .end('{}');
    };
    const response = await send(build().app, '/api/v1/transactions', {
      method: 'POST',
      headers: write,
      body: '{}',
    });
    expect(response.headers.get('Location')).toBe(`/api/v1/transactions/${ID}`);
  });

  it('never lets ledgerd send the browser somewhere else', async () => {
    respond = (_request, response) => {
      response
        .writeHead(201, {
          'Content-Type': 'application/json',
          Location: 'https://evil.example/phish',
        })
        .end('{}');
    };
    const response = await send(build().app, '/api/v1/transactions', {
      method: 'POST',
      headers: write,
      body: '{}',
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('the browser never sees the API key, in any header or body, even if ledgerd echoes it', async () => {
    respond = (request, response) => {
      // A buggy or hostile upstream that reflects what it received into its headers.
      response
        .writeHead(200, {
          'Content-Type': 'application/json',
          'X-Echo-Authorization': String(request.headers.authorization),
          'Set-Cookie': `k=${TEST_KEY}`,
        })
        .end('{"fine":true}');
    };
    const response = await send(build().app, '/api/v1/accounts');
    const everything = JSON.stringify([...response.headers.entries()]) + (await response.text());
    expect(everything).not.toContain(TEST_KEY);
  });

  it('a request id is on every answer', async () => {
    const response = await send(build().app, '/api/v1/accounts');
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('when ledgerd rejects the console, or cannot be reached', () => {
  it.each([401, 403])(
    'turns ledgerd %i into a 502 the browser cannot mistake for its own fault',
    async (status) => {
      respond = (_request, response) => {
        response
          .writeHead(status, {
            'Content-Type': 'application/problem+json',
            'WWW-Authenticate': 'Bearer realm="ledgerd"',
          })
          .end(
            `{"type":"urn:ledgerd:error:unauthorized","title":"Unauthorized","status":${String(status)},"code":"unauthorized","detail":"a valid API key is required"}`,
          );
      };
      const { app, log } = build();
      const response = await send(app, '/api/v1/accounts');

      expect(response.status).toBe(502);
      expect(response.headers.get('WWW-Authenticate')).toBeNull(); // no login prompt for a server-side problem
      const body = await response.json();
      expect(body).toMatchObject({ code: 'console_misconfigured', status: 502 });
      expect(JSON.stringify(body)).not.toMatch(/valid API key|unauthorized/i);

      const error = log.lines().find((l) => l.level === 'error');
      expect(String(error?.msg)).toContain('LEDGERD_API_KEY');
      expect(log.raw()).not.toContain(TEST_KEY);
    },
  );

  it('answers 504 when ledgerd is not there, and explains without technical detail', async () => {
    const dead = await startFakeLedgerd();
    const url = dead.url;
    await dead.close(); // nothing listens on this port any more
    const { app } = build({ ledgerdUrl: url });
    const response = await send(app, '/api/v1/accounts');
    expect(response.status).toBe(504);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('upstream_unavailable');
    expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
  });

  it('cancels a call that takes too long and answers 504', async () => {
    respond = () => undefined; // never answers
    const started = performance.now();
    const response = await send(build({ forwardTimeoutMs: 100 }).app, '/api/v1/accounts');
    expect(response.status).toBe(504);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('does not follow a redirect (which would carry the key to another place)', async () => {
    const elsewhere = await startFakeLedgerd();
    respond = (_request, response) => {
      response.writeHead(302, { Location: `${elsewhere.url.origin}/steal` }).end();
    };
    const response = await send(build().app, '/api/v1/accounts');
    expect(response.status).toBe(502);
    expect(elsewhere.requests).toHaveLength(0);
    await elsewhere.close();
  });

  it("relays ledgerd refusals that are the browser's concern (422, 404, 409, 503) unchanged", async () => {
    for (const status of [404, 409, 422, 503]) {
      respond = (_request, response) => {
        response
          .writeHead(status, { 'Content-Type': 'application/problem+json' })
          .end(`{"status":${String(status)},"code":"x"}`);
      };
      const response = await send(build().app, '/api/v1/accounts');
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ status, code: 'x' });
    }
  });
});

describe('logging', () => {
  it('marks forwarded calls, and never logs the key, bodies, query strings or headers', async () => {
    const { app, log } = build();
    await send(app, `/api/v1/accounts/${ID}/balance?as_of=SECRET-QUERY`, {
      headers: { Cookie: 'sid=SECRET-COOKIE' },
    });
    await send(app, '/api/v1/transactions', {
      method: 'POST',
      headers: { ...write, 'Idempotency-Key': 'SECRET-IDEM' },
      body: '{"description":"SECRET-BODY"}',
    });
    const access = log.lines().filter((l) => l.msg === 'request');
    expect(access.map((l) => l.forwarded)).toEqual([true, true]);
    expect(log.raw()).not.toMatch(/SECRET-|Bearer/);
    expect(log.raw()).not.toContain(TEST_KEY);
  });

  it("does not mark the server's own probes as forwarded", async () => {
    const { app, log } = build();
    await send(app, '/healthz');
    expect(log.lines().find((l) => l.msg === 'request')?.forwarded).toBe(false);
  });
});

describe('rewriteLocation', () => {
  const ledgerdUrl = new URL('http://ledgerd:8085');
  it.each<[string, string | undefined]>([
    ['/v1/transactions/abc', '/api/v1/transactions/abc'],
    ['/v1/accounts?cursor=x', '/api/v1/accounts?cursor=x'],
    ['http://ledgerd:8085/v1/transactions/abc', '/api/v1/transactions/abc'],
    ['http://other:8085/v1/transactions/abc', undefined],
    ['https://ledgerd:8085/v1/x', undefined],
    ['//evil.example/v1/x', undefined],
    ['javascript:alert(1)', undefined],
    ['', undefined],
    ['/', undefined],
    ['/healthz', undefined],
  ])('%j becomes %j', (input, expected) => {
    expect(rewriteLocation(input, ledgerdUrl)).toBe(expected);
  });

  it('honours a base path in LEDGERD_URL', () => {
    expect(rewriteLocation('/ledger/v1/accounts/1', new URL('http://h:1/ledger/'))).toBe(
      '/api/v1/accounts/1',
    );
    expect(rewriteLocation('/v1/accounts/1', new URL('http://h:1/ledger/'))).toBeUndefined();
  });
});
