# 0001. A small server holds the API key, and the browser only ever talks to it

Status: accepted

## Context

ledgerd authenticates with one API key. A web application runs in the user's browser, so
anything it contains, including a key compiled into it, can be read by anyone who opens the
developer tools, and can be copied and used from anywhere.

There is a trap in the usual tooling: Vite inlines `import.meta.env.VITE_*` values into the
bundle, so "just put the key in the environment" ends with the key in a public file.

A console that holds a financial API key is also reachable by every web page the user visits
while it is running: a page can try to send requests to `localhost` (cross-site request
forgery), or point its own domain at `127.0.0.1` and read the answers (DNS rebinding).

## Decision

- The application is served by a **console server** (Node, Hono). It reads the key from its
  own environment, wraps it in a type that prints as `[REDACTED]`, and adds the
  `Authorization` header itself to what it forwards. The browser never has the key and never
  sends one.
- The browser talks only to the console's own origin, under `/api`. There is no cross-origin
  request, so there is no CORS to configure and none to get wrong.
- The server forwards **only an allow-list** of ledgerd's paths and methods, and a short
  allow-list of headers in each direction (no cookies). Anything else is answered `404` or
  `405` without contacting ledgerd. A test compares the allow-list with ledgerd's OpenAPI
  file, so a new endpoint is a decision, not an accident.
- Two independent checks stop other sites from using the console: the `Host` header must be
  one the console serves (DNS rebinding), and every state-changing request must carry a
  custom header and, if it has an `Origin`, that origin must be the console's own (CSRF). A
  custom header cannot be sent cross-site without a CORS preflight, which the server never
  grants.
- It listens on the loopback interface by default, sends a Content Security Policy that
  allows no inline script and no other origin, limits body size, and rate-limits clients.
- Three checks fail the build instead of relying on care: the client bundle must not contain
  the code that builds an `Authorization` header; a throwaway build with a canary key must not
  contain that key in any form (plain, URL-encoded, hexadecimal, base64) in any emitted file,
  source maps included; and `index.html` must have no inline script or style.

## Consequences

- One more process to run and to secure. The price is a small program (about 1,100 lines, plus
  its tests) in the same language as the application.
- The key never appears in HTML, scripts, source maps, responses, URLs, local storage or
  logs. Tests send hostile requests (wrong host, forged origin, missing header, oversized
  body, a flood) and assert each refusal.
- **The console has no login of its own.** Anyone who can reach the console server can use
  the ledger through it. That is why it listens on loopback by default, why the compose file
  publishes its port on `127.0.0.1` only, and why the container logs a warning when it
  listens on a non-loopback address. Exposing it to a network needs an authenticating proxy in
  front of it; that is out of scope.
- Every browser call must go through the one API client that adds the custom header.

## Alternatives considered

- **The key in the browser** (build-time or typed in by the user and kept in local storage):
  the key becomes public, or readable by any script that runs on the page.
- **A generic reverse proxy** (nginx, Caddy) adding the header: it would hide the key, but an
  allow-list that is tested against the OpenAPI file, the `Host`/`Origin` checks, and the
  redaction of logs are application logic that would live in configuration nobody tests.
- **Per-user login in the console:** the right answer for a shared deployment, and a different
  project. The scope here is a local-first console.
