// Container health check: asks the console server's own /healthz.
//
// The server only answers requests whose Host header it is configured to serve, so this sends
// the first of CONSOLE_ALLOWED_HOSTS (what a browser would send), to the port in CONSOLE_ADDR.
// Exit status 0 means healthy.
import { request } from 'node:http';

const address = process.env.CONSOLE_ADDR ?? '127.0.0.1:8787';
const port = Number.parseInt(address.slice(address.lastIndexOf(':') + 1), 10);
const host = (process.env.CONSOLE_ALLOWED_HOSTS ?? `127.0.0.1:${String(port)}`)
  .split(',')[0]
  .trim();

const req = request(
  {
    host: '127.0.0.1',
    port,
    path: '/healthz',
    headers: { Host: host },
    timeout: 3000,
    agent: false,
  },
  (res) => {
    res.resume();
    res.on('end', () => {
      process.exit(res.statusCode === 200 ? 0 : 1);
    });
  },
);
req.on('timeout', () => {
  req.destroy();
});
req.on('error', () => {
  process.exit(1);
});
req.end();
