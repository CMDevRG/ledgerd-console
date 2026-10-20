import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from './server';

describe('the test setup (R16.1)', () => {
  it('fails a request that no handler answers, and never lets it reach the network', async () => {
    // A real server on this machine: if the request got out, it would be counted.
    let reached = 0;
    const real = createServer((_request, response) => {
      reached += 1;
      response.end('{}');
    });
    await new Promise<void>((done) => real.listen(0, '127.0.0.1', done));
    try {
      const { port } = real.address() as AddressInfo;
      await expect(fetch(`http://127.0.0.1:${String(port)}/v1/accounts`)).rejects.toThrow();
      expect(reached).toBe(0);
    } finally {
      await new Promise((done) => real.close(done));
    }
  });

  it('answers a request that a test has given a handler', async () => {
    server.use(http.get('http://mocked.invalid/ok', () => HttpResponse.json({ ok: true })));
    const response = await fetch('http://mocked.invalid/ok');
    expect(await response.json()).toEqual({ ok: true });
  });
});
