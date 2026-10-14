import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// A canary for the server toolchain: Hono runs in Node, in-process, without a socket.
// Everything the console server is tested with (app.request) relies on this working.
describe('server toolchain', () => {
  it('runs a Hono app in-process', async () => {
    const app = new Hono().get('/ping', (c) => c.json({ pong: true }));
    const response = await app.request('/ping');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pong: true });
  });

  it('runs in a Node environment, not a browser one', () => {
    expect('window' in globalThis).toBe(false);
    expect(typeof process.versions.node).toBe('string');
  });
});
