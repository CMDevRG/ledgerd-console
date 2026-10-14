import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

import { createApp, type AppDeps } from './app';

export interface RunningServer {
  /** The address actually bound (useful when the port was 0). */
  address: AddressInfo;
  /**
   * Stops accepting connections, lets requests in progress finish, and resolves when the
   * server is closed. After `timeoutMs` whatever is still running is cut off and the result
   * is `{ forced: true }`.
   */
  close(timeoutMs: number): Promise<{ forced: boolean }>;
}

export async function startServer(deps: AppDeps): Promise<RunningServer> {
  const app = createApp(deps);
  // No custom server factory is passed, so this is a plain HTTP/1 server.
  const server = serve({
    fetch: app.fetch,
    hostname: deps.config.host,
    port: deps.config.port,
  }) as Server;
  await once(server, 'listening');

  return {
    address: server.address() as AddressInfo,
    async close(timeoutMs) {
      let forced = false;
      const closed = once(server, 'close');
      server.close(); // no new connections
      // A connection that was busy when we started becomes idle (and stays open, kept
      // alive) once its response is done. Close those as they appear, so shutdown ends
      // as soon as the last request does instead of waiting for keep-alive timeouts.
      const sweep = setInterval(() => {
        server.closeIdleConnections();
      }, 25);
      const deadline = setTimeout(() => {
        forced = true;
        server.closeAllConnections();
      }, timeoutMs);
      await closed;
      clearInterval(sweep);
      clearTimeout(deadline);
      return { forced };
    },
  };
}
