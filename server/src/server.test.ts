import { describe, expect, it } from 'vitest';

import { startServer } from './server';
import { captureLogger, testConfig } from './testkit';

async function start(check: () => Promise<boolean>) {
  const log = captureLogger();
  const running = await startServer({
    config: testConfig(),
    logger: log.logger,
    checkLedgerd: check,
  });
  const base = `http://127.0.0.1:${String(running.address.port)}`;
  return { running, base, log };
}

describe('the running server', () => {
  it('serves requests over a real socket', async () => {
    const { running, base } = await start(() => Promise.resolve(true));
    try {
      const response = await fetch(`${base}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
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
    const { running, base } = await start(() => slow);

    const inFlight = fetch(`${base}/readyz`); // blocks until we release the check
    await new Promise((r) => setTimeout(r, 50));

    const closing = running.close(5000);
    await new Promise((r) => setTimeout(r, 50));
    await expect(fetch(`${base}/healthz`)).rejects.toThrow(); // the listener is already closed

    release(true); // the slow request can now complete normally
    const response = await inFlight;
    expect(response.status).toBe(200);
    const started = performance.now();
    expect(await closing).toEqual({ forced: false });
    // Shutdown ends right after the last request, not after a keep-alive timeout.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('cuts off requests that outlast the shutdown timeout, and says so', async () => {
    const { running, base } = await start(() => new Promise<boolean>(() => undefined));
    const stuck = fetch(`${base}/readyz`).then(
      () => 'completed',
      () => 'cut off',
    );
    await new Promise((r) => setTimeout(r, 50));

    const result = await running.close(100);
    expect(result).toEqual({ forced: true });
    expect(await stuck).toBe('cut off');
  });
});
