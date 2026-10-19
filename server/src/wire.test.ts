import { request } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from './server';
import {
  captureLogger,
  CONSOLE_HEADERS,
  HOST,
  startFakeLedgerd,
  testConfig,
  type FakeLedgerd,
} from './testkit';

/*
 * What the in-process tests cannot see: how a request looks when it arrives over a socket.
 * There, the server library gives every POST a body stream even when the client sent none, which
 * a test using app.request() never has. A reversal is such a request, and the first version of
 * the body check refused it with 415 -- found by running the real stack, not by a test.
 */

let ledgerd: FakeLedgerd;
let server: RunningServer;
beforeAll(async () => {
  ledgerd = await startFakeLedgerd();
  server = await startServer({
    config: testConfig({ ledgerdUrl: ledgerd.url }),
    logger: captureLogger().logger,
    checkLedgerd: () => Promise.resolve(true),
  });
});
afterAll(async () => {
  await server.close(2000);
  await ledgerd.close();
});

interface Reply {
  status: number;
  body: string;
}

function send(options: {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  /** Pieces of the body; more than one are sent chunked (no Content-Length). */
  body?: string[];
}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.address.port,
        method: options.method ?? 'POST',
        path: options.path,
        agent: false,
        headers: { Host: HOST, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
        });
      },
    );
    req.on('error', reject);
    for (const piece of options.body ?? []) req.write(piece);
    req.end();
  });
}

const reachedLedgerd = () => ledgerd.requests.at(-1);

describe('a POST with nothing to say, as a browser sends a reversal or a reconciliation', () => {
  it('with no body and no content type (curl) is forwarded', async () => {
    const before = ledgerd.requests.length;
    const reply = await send({
      path: '/api/v1/transactions/3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11/reverse',
      headers: { ...CONSOLE_HEADERS, 'Content-Length': '0', 'Idempotency-Key': 'r1' },
    });
    expect(reply.status).toBe(200);
    expect(ledgerd.requests).toHaveLength(before + 1);
    expect(reachedLedgerd()).toMatchObject({
      method: 'POST',
      url: '/v1/transactions/3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11/reverse',
      body: '',
    });
    expect(reachedLedgerd()?.headers['idempotency-key']).toBe('r1');
  });

  it('with an explicit Content-Length: 0 and a JSON content type is forwarded too', async () => {
    const reply = await send({
      path: '/api/v1/reconciliations?deep=true',
      headers: { ...CONSOLE_HEADERS, 'Content-Type': 'application/json', 'Content-Length': '0' },
    });
    expect(reply.status).toBe(200);
    expect(reachedLedgerd()).toMatchObject({
      method: 'POST',
      url: '/v1/reconciliations?deep=true',
      body: '',
    });
  });

  it('with no length header at all (as a client that sends nothing may) is forwarded', async () => {
    const reply = await send({ path: '/api/v1/reconciliations', headers: CONSOLE_HEADERS });
    expect(reply.status).toBe(200);
  });
});

describe('a POST with a body', () => {
  it('as JSON is forwarded intact', async () => {
    const body = '{"code":"a","currency":"USD"}';
    const reply = await send({
      path: '/api/v1/accounts',
      headers: {
        ...CONSOLE_HEADERS,
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body: [body],
    });
    expect(reply.status).toBe(200);
    expect(reachedLedgerd()?.body).toBe(body);
    expect(reachedLedgerd()?.headers['content-type']).toBe('application/json');
  });

  it('sent in chunks, with no Content-Length, is forwarded intact', async () => {
    const reply = await send({
      path: '/api/v1/accounts',
      headers: { ...CONSOLE_HEADERS, 'Content-Type': 'application/json' },
      body: ['{"code":', '"chunked"}'],
    });
    expect(reply.status).toBe(200);
    expect(reachedLedgerd()?.body).toBe('{"code":"chunked"}');
  });

  it('without a content type is refused with 415, whether sized or chunked', async () => {
    const before = ledgerd.requests.length;
    const sized = await send({
      path: '/api/v1/accounts',
      headers: { ...CONSOLE_HEADERS, 'Content-Length': '2' },
      body: ['{}'],
    });
    const chunked = await send({
      path: '/api/v1/accounts',
      headers: CONSOLE_HEADERS,
      body: ['{', '}'],
    });
    expect([sized.status, chunked.status]).toEqual([415, 415]);
    expect(ledgerd.requests).toHaveLength(before);
  });

  it('with another content type is refused with 415', async () => {
    const reply = await send({
      path: '/api/v1/accounts',
      headers: { ...CONSOLE_HEADERS, 'Content-Type': 'text/plain', 'Content-Length': '2' },
      body: ['{}'],
    });
    expect(reply.status).toBe(415);
  });

  it('too large, sent in chunks with no length to check in advance, is refused with 413', async () => {
    const before = ledgerd.requests.length;
    const piece = 'x'.repeat(16 * 1024);
    const reply = await send({
      path: '/api/v1/accounts',
      headers: { ...CONSOLE_HEADERS, 'Content-Type': 'application/json' },
      body: Array.from({ length: 8 }, () => piece),
    });
    expect(reply.status).toBe(413);
    expect(ledgerd.requests).toHaveLength(before);
  });

  it('too large, declared up front, is refused with 413', async () => {
    const reply = await send({
      path: '/api/v1/accounts',
      headers: {
        ...CONSOLE_HEADERS,
        'Content-Type': 'application/json',
        'Content-Length': String(70 * 1024),
      },
      body: ['{}'],
    });
    expect(reply.status).toBe(413);
  });
});
