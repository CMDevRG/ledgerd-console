import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../api/problem';
import { server } from '../../test/server';
import { createIdSource, createLabApi, SHOWN_REQUEST_HEADERS, SHOWN_RESPONSE_HEADERS } from './api';

describe('createLabApi', () => {
  it('records a successful exchange: method, path, key, body, status, headers and answer', async () => {
    server.use(
      http.post('*/api/v1/transactions', () =>
        HttpResponse.json(
          { id: 'abc' },
          {
            status: 201,
            headers: {
              'Idempotent-Replayed': 'true',
              'X-Request-Id': 'req-1',
              Location: '/v1/transactions/abc',
            },
          },
        ),
      ),
    );
    const exchange = await createLabApi().send({
      method: 'POST',
      path: '/v1/transactions',
      idempotencyKey: 'key-1',
      body: { postings: [] },
    });
    expect(exchange).toMatchObject({
      method: 'POST',
      path: '/v1/transactions',
      requestHeaders: { 'content-type': 'application/json', 'idempotency-key': 'key-1' },
      body: { postings: [] },
      status: 201,
      responseHeaders: {
        'idempotent-replayed': 'true',
        'x-request-id': 'req-1',
        location: '/v1/transactions/abc',
        'content-type': 'application/json',
      },
      responseBody: { id: 'abc' },
    });
    expect(exchange.ms).toBeGreaterThanOrEqual(0);
  });

  it('records a refusal as an exchange and does not throw', async () => {
    server.use(
      http.post('*/api/v1/transactions', () =>
        HttpResponse.json(
          { code: 'insufficient_funds', status: 422 },
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const exchange = await createLabApi().send({
      method: 'POST',
      path: '/v1/transactions',
      body: {},
    });
    expect(exchange.status).toBe(422);
    expect(exchange.responseBody).toEqual({ code: 'insufficient_funds', status: 422 });
  });

  it('records a GET without a body or a key', async () => {
    server.use(http.get('*/api/v1/accounts/x', () => HttpResponse.json({ balance: '5' })));
    const exchange = await createLabApi().send({ method: 'GET', path: '/v1/accounts/x' });
    expect(exchange.requestHeaders).toEqual({});
    expect('body' in exchange).toBe(false);
  });

  it('keeps an answer that is not JSON as text, and an empty one as undefined', async () => {
    server.use(
      http.get('*/api/text', () => new HttpResponse('plain words', { status: 502 })),
      http.get('*/api/empty', () => new HttpResponse(null, { status: 204 })),
    );
    const api = createLabApi();
    expect((await api.send({ method: 'GET', path: '/text' })).responseBody).toBe('plain words');
    expect((await api.send({ method: 'GET', path: '/empty' })).responseBody).toBeUndefined();
  });

  it('throws only when there is no answer at all', async () => {
    server.use(http.get('*/api/v1/readyz', () => HttpResponse.error()));
    await expect(createLabApi().send({ method: 'GET', path: '/v1/readyz' })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('sends a JSON number where the scenario puts one (the number is not turned into a string)', async () => {
    let received = '';
    server.use(
      http.post('*/api/v1/transactions', async ({ request }) => {
        received = await request.text();
        return HttpResponse.json({});
      }),
    );
    await createLabApi().send({ method: 'POST', path: '/v1/transactions', body: { amount: 100 } });
    expect(received).toBe('{"amount":100}');
  });
});

describe('observeConcurrency', () => {
  const resource = (requestStart: number, responseEnd: number) => ({
    name: 'http://localhost/api/v1/transactions',
    initiatorType: 'fetch',
    startTime: 11,
    requestStart,
    responseEnd,
  });

  it("runs the work, and reports the most requests on the network at once from the browser's timings", async () => {
    const timing = {
      now: () => 10,
      getEntriesByType: () => [
        resource(12, 30),
        resource(12, 31),
        resource(30, 50),
        resource(31, 51),
      ],
    };
    const { value, peak } = (await createLabApi(timing).observeConcurrency?.(() =>
      Promise.resolve('done'),
    )) ?? { value: '', peak: -1 };
    expect(value).toBe('done');
    expect(peak).toBe(2);
  });

  it('says it does not know when the browser has no timings', async () => {
    const none = await createLabApi({ now: () => 0 }).observeConcurrency?.(() =>
      Promise.resolve(1),
    );
    expect(none).toEqual({ value: 1, peak: undefined });
    const empty = await createLabApi({
      now: () => 0,
      getEntriesByType: () => [],
    }).observeConcurrency?.(() => Promise.resolve(2));
    expect(empty).toEqual({ value: 2, peak: undefined });
  });

  it('passes on a failure of the work', async () => {
    await expect(
      createLabApi().observeConcurrency?.(() => Promise.reject(new Error('no answer'))),
    ).rejects.toThrow('no answer');
  });
});

describe('what an exchange can reveal (R9.3: never the API key)', () => {
  it('only lists headers by name to keep, none of which can hold a credential', () => {
    const all = [...SHOWN_REQUEST_HEADERS, ...SHOWN_RESPONSE_HEADERS] as string[];
    for (const forbidden of [
      'authorization',
      'cookie',
      'set-cookie',
      'proxy-authorization',
      'x-api-key',
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('drops every other header, even one that carries the key, whoever put it there', async () => {
    server.use(
      http.get('*/api/v1/accounts/x', () =>
        HttpResponse.json(
          {},
          {
            headers: {
              Authorization: 'Bearer SECRET-KEY',
              'Set-Cookie': 'sid=SECRET',
              'X-Debug': 'SECRET',
              'Content-Type': 'application/json',
            },
          },
        ),
      ),
    );
    const exchange = await createLabApi().send({ method: 'GET', path: '/v1/accounts/x' });
    expect(JSON.stringify(exchange)).not.toContain('SECRET');
    expect(Object.keys(exchange.responseHeaders)).toEqual(['content-type']);
  });

  it('records only the headers the scenario set, not the ones the console adds', async () => {
    server.use(http.post('*/api/v1/accounts', () => HttpResponse.json({}, { status: 201 })));
    const exchange = await createLabApi().send({ method: 'POST', path: '/v1/accounts', body: {} });
    expect(Object.keys(exchange.requestHeaders)).toEqual(['content-type']); // not X-Ledgerd-Console
  });
});

describe('createIdSource', () => {
  it('gives short, different run ids and valid keys', () => {
    const ids = createIdSource();
    const runs = new Set(Array.from({ length: 100 }, () => ids.runId()));
    expect(runs.size).toBe(100);
    for (const run of runs) expect(run).toMatch(/^[0-9a-f]{8}$/);
    expect(ids.key()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
