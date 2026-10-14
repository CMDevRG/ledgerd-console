import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { server } from '../test/server';
import { CONSOLE_HEADER, request } from './client';
import { ApiError } from './problem';
import { makeConsoleProblem, makeProblem } from '../test/factories';

const thing = z.object({ n: z.number() });

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('request', () => {
  it('returns the validated body with the status, request id and location', async () => {
    server.use(
      http.get('*/api/thing', () =>
        HttpResponse.json(
          { n: 7 },
          { headers: { 'X-Request-Id': 'req-1', Location: '/api/thing/7' } },
        ),
      ),
    );
    const result = await request({ path: '/thing', schema: thing });
    expect(result).toEqual({
      data: { n: 7 },
      status: 200,
      replayed: false,
      requestId: 'req-1',
      location: '/api/thing/7',
    });
  });

  it('sends the path under /api, with the query and without undefined values', async () => {
    let url = '';
    server.use(
      http.get('*/api/thing', ({ request: r }) => ((url = r.url), HttpResponse.json({ n: 1 }))),
    );
    await request({
      path: '/thing',
      query: { a: 'x y', b: 2, c: true, d: undefined },
      schema: thing,
    });
    expect(new URL(url).search).toBe('?a=x+y&b=2&c=true');
  });

  it('adds the console header to writes, never to reads', async () => {
    const seen: { get?: string | null; post?: string | null } = {};
    server.use(
      http.get(
        '*/api/thing',
        ({ request: r }) => (
          (seen.get = r.headers.get(CONSOLE_HEADER)),
          HttpResponse.json({ n: 1 })
        ),
      ),
      http.post(
        '*/api/thing',
        ({ request: r }) => (
          (seen.post = r.headers.get(CONSOLE_HEADER)),
          HttpResponse.json({ n: 1 })
        ),
      ),
    );
    await request({ path: '/thing', schema: thing });
    await request({ method: 'POST', path: '/thing', schema: thing });
    expect(seen).toEqual({ get: null, post: '1' });
  });

  it('sends a JSON body with its content type, and none when there is no body', async () => {
    const seen: { type: string | null; body: string }[] = [];
    server.use(
      http.post('*/api/thing', async ({ request: r }) => {
        seen.push({ type: r.headers.get('Content-Type'), body: await r.text() });
        return HttpResponse.json({ n: 1 });
      }),
    );
    await request({ method: 'POST', path: '/thing', body: { a: 1 }, schema: thing });
    await request({ method: 'POST', path: '/thing', schema: thing });
    expect(seen).toEqual([
      { type: 'application/json', body: '{"a":1}' },
      { type: null, body: '' },
    ]);
  });

  it('never sends credentials of its own', async () => {
    let authorization: string | null = 'unset';
    server.use(
      http.get(
        '*/api/thing',
        ({ request: r }) => (
          (authorization = r.headers.get('Authorization')),
          HttpResponse.json({ n: 1 })
        ),
      ),
    );
    await request({ path: '/thing', schema: thing });
    expect(authorization).toBeNull();
  });

  it('reports a replay when the server says so', async () => {
    server.use(
      http.post('*/api/thing', () =>
        HttpResponse.json({ n: 1 }, { headers: { 'Idempotent-Replayed': 'true' } }),
      ),
    );
    expect((await request({ method: 'POST', path: '/thing', schema: thing })).replayed).toBe(true);
  });

  describe('failures', () => {
    it('a problem document is a refusal, with its code and field errors', async () => {
      server.use(
        http.post('*/api/thing', () =>
          HttpResponse.json(
            makeProblem({
              request_id: 'req-9',
              errors: [
                { field: 'postings[0].amount', message: 'bad' },
                { field: 'postings[0].amount', message: 'second' },
              ],
            }),
            { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
          ),
        ),
      );
      const error = await failure(request({ method: 'POST', path: '/thing', schema: thing }));
      expect(error.kind).toBe('refused');
      expect(error.status).toBe(422);
      expect(error.code).toBe('validation_error');
      expect(error.requestId).toBe('req-9');
      expect(error.fieldErrors).toEqual({ 'postings[0].amount': 'bad' });
      expect(error.message).toBe('Validation failed');
    });

    it('503 is "busy" and carries the suggested wait', async () => {
      server.use(
        http.get('*/api/thing', () =>
          HttpResponse.json(
            makeProblem({
              status: 503,
              code: 'temporarily_unavailable',
              title: 'Temporarily unavailable',
            }),
            {
              status: 503,
              headers: { 'Retry-After': '3' },
            },
          ),
        ),
      );
      const error = await failure(request({ path: '/thing', schema: thing }));
      expect(error.kind).toBe('busy');
      expect(error.retryAfterSeconds).toBe(3);
    });

    it('ignores a Retry-After it cannot read', async () => {
      server.use(
        http.get('*/api/thing', () =>
          HttpResponse.json(makeProblem({ status: 503 }), {
            status: 503,
            headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
          }),
        ),
      );
      expect(
        (await failure(request({ path: '/thing', schema: thing }))).retryAfterSeconds,
      ).toBeUndefined();
    });

    it.each([502, 504])(
      '%i from the console server means ledgerd is unreachable',
      async (status) => {
        server.use(
          http.get('*/api/thing', () =>
            HttpResponse.json(makeConsoleProblem('upstream_unavailable', status), { status }),
          ),
        );
        expect((await failure(request({ path: '/thing', schema: thing }))).kind).toBe('network');
      },
    );

    it('a network failure is "network"', async () => {
      server.use(http.get('*/api/thing', () => HttpResponse.error()));
      const error = await failure(request({ path: '/thing', schema: thing }));
      expect(error.kind).toBe('network');
      expect(error.status).toBeUndefined();
    });

    it('a timeout cancels the request and says so', async () => {
      server.use(http.get('*/api/thing', () => new Promise(() => undefined)));
      const error = await failure(request({ path: '/thing', schema: thing, timeoutMs: 30 }));
      expect(error.kind).toBe('network');
      expect(error.message).toMatch(/longer than/);
    });

    it('a body that does not match the schema is "unexpected", not a value', async () => {
      server.use(http.get('*/api/thing', () => HttpResponse.json({ n: 'seven' })));
      const error = await failure(request({ path: '/thing', schema: thing }));
      expect(error.kind).toBe('unexpected');
      expect(error.status).toBe(200);
    });

    it('a success without JSON is "unexpected"', async () => {
      server.use(
        http.get(
          '*/api/thing',
          () =>
            new HttpResponse('<html>captive portal</html>', {
              headers: { 'Content-Type': 'text/html' },
            }),
        ),
      );
      expect((await failure(request({ path: '/thing', schema: thing }))).kind).toBe('unexpected');
    });

    it('an error that is not a problem document is "unexpected" and shows no raw body', async () => {
      server.use(
        http.get(
          '*/api/thing',
          () => new HttpResponse('<pre>stack trace at /srv/app.js:12</pre>', { status: 500 }),
        ),
      );
      const error = await failure(request({ path: '/thing', schema: thing }));
      expect(error.kind).toBe('unexpected');
      expect(error.message).not.toMatch(/stack trace|srv/);
    });

    it('lets a cancellation by the caller through, so queries can be superseded quietly', async () => {
      server.use(http.get('*/api/thing', () => new Promise(() => undefined)));
      const controller = new AbortController();
      const pending = request({ path: '/thing', schema: thing, signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.not.toBeInstanceOf(ApiError);
    });
  });
});
