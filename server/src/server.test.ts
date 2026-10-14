import { request } from 'node:http';

import { describe, expect, it } from 'vitest';

import { startServer } from './server';
import { captureLogger, HOST, testConfig } from './testkit';

async function start(check: () => Promise<boolean>) {
  const log = captureLogger();
  const running = await startServer({
    config: testConfig(),
    logger: log.logger,
    checkLedgerd: check,
  });
  return { running, port: running.address.port, log };
}

interface Reply {
  status: number;
  body: string;
}

/**
 * A plain HTTP/1.1 request with the Host a browser would send. (fetch cannot set Host, and
 * the server is configured, as in production, to serve one host name.) One connection per
 * request, so nothing is kept alive between tests.
 */
function get(port: number, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, agent: false, headers: { Host: HOST } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('the running server', () => {
  it('serves requests over a real socket', async () => {
    const { running, port } = await start(() => Promise.resolve(true));
    try {
      const response = await get(port, '/healthz');
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
    } finally {
      await running.close(1000);
    }
  });

  it('listens only where it was told to', async () => {
    const { running } = await start(() => Promise.resolve(true));
    try {
      expect(running.address.address).toBe('127.0.0.1');
    } finally {
      await running.close(1000);
    }
  });

  it('on shutdown, stops accepting new connections but lets a request in progress finish', async () => {
    let release: (ready: boolean) => void = () => undefined;
    const slow = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const { running, port } = await start(() => slow);

    const inFlight = get(port, '/readyz'); // blocks until we release the check
    await new Promise((r) => setTimeout(r, 50));

    const closing = running.close(5000);
    await new Promise((r) => setTimeout(r, 50));
    await expect(get(port, '/healthz')).rejects.toThrow(); // the listener is already closed

    release(true); // the slow request can now complete normally
    const response = await inFlight;
    expect(response.status).toBe(200);
    const started = performance.now();
    expect(await closing).toEqual({ forced: false });
    // Shutdown ends right after the last request, not after a keep-alive timeout.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('cuts off requests that outlast the shutdown timeout, and says so', async () => {
    const { running, port } = await start(() => new Promise<boolean>(() => undefined));
    const stuck = get(port, '/readyz').then(
      () => 'completed',
      () => 'cut off',
    );
    await new Promise((r) => setTimeout(r, 50));

    const result = await running.close(100);
    expect(result).toEqual({ forced: true });
    expect(await stuck).toBe('cut off');
  });
});
