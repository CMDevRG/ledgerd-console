# ledgerd console

[![CI](https://github.com/CMDevRG/ledgerd-console/actions/workflows/ci.yml/badge.svg)](https://github.com/CMDevRG/ledgerd-console/actions/workflows/ci.yml)

A web console for [ledgerd](https://github.com/CMDevRG/ledgerd), a double-entry accounting
ledger with an HTTP API. It does three things:

- **Use the ledger:** accounts, balances (now and at a past moment), history, transfers
  with any number of postings, reversals.
- **Try to break it on purpose:** the _Failure Lab_ runs eight scenarios (overdraft, a retried
  request, a reused key, an unbalanced transaction, a number where a string belongs, amounts up
  to 10^30, a double reversal, thirty simultaneous withdrawals) and says whether the ledger
  behaved as designed, showing every request and response.
- **Watch it prove itself:** reconciliation checks stored balances against the postings, and
  the benchmark page shows how ledgerd performed, under which conditions.

It is also an exercise in building a front end for a financial API carefully: the API key never
reaches the browser, money is never a floating-point number, the API types come from the
contract, and every page is tested in a real browser against a real ledger. The reasons are in
the [decision records](docs/adr/README.md).

> **Local-first, not production-ready.** The console has no login of its own: anyone who can
> reach it can use the ledger through it. It listens on this machine only, by default. See
> [Limitations](#limitations).

**Requires ledgerd 0.2.0**, the first release with `GET /v1/accounts`. The quick start below
runs the published ledgerd 0.2.0 images, so there is nothing else to install.

## Screenshots

Taken by the end-to-end test run (`make screenshots`), from a real console over a real ledger,
so they cannot go stale.

|                                                                                                                                                                     |                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ![Overview](docs/screenshots/overview.png)<br>**Overview**                                                                                                          | ![Accounts](docs/screenshots/accounts.png)<br>**Accounts**                                                                            |
| ![Account with history](docs/screenshots/account-detail.png)<br>**An account and its history**, with the intermediate posting of a multi-posting transaction marked | ![The same in the dark theme](docs/screenshots/dark-account-detail.png)<br>**The dark theme** follows the system, or the setting      |
| ![New transaction](docs/screenshots/new-transaction.png)<br>**The transaction builder**, balanced per currency                                                      | ![A repeat that is a replay](docs/screenshots/replay.png)<br>**Idempotency made visible**: sending the same request again is a replay |
| ![An overdraft, refused](docs/screenshots/overdraft-refused.png)<br>**A refusal**, with the error code and the request id                                           | ![A transaction](docs/screenshots/transaction.png)<br>**A transaction**, which can be reversed (never edited)                         |
| ![Looking a transaction up](docs/screenshots/transaction-lookup.png)<br>**Looking a transaction up** by its id                                                      | ![Reconciliation](docs/screenshots/reconciliation.png)<br>**Reconciliation**                                                          |
| ![The overdraft scenario](docs/screenshots/lab-overdraft.png)<br>**Failure Lab**: overdraft                                                                         | ![The concurrency scenario](docs/screenshots/lab-concurrency.png)<br>**Failure Lab**: thirty simultaneous withdrawals                 |
| ![Benchmark](docs/screenshots/benchmark-charts.png)<br>**Benchmark**, each chart with its data table                                                                | ![Settings](docs/screenshots/settings.png)<br>**Settings**: theme, and the decimal places of each currency                            |

On a phone (360 px wide and up) nothing scrolls sideways; wide tables scroll inside their own
container:

<img src="docs/screenshots/mobile-new-transaction.png" alt="The transaction builder on a phone" width="260">

## Quick start

Requires Docker (with Compose) and `make`. Nothing else.

```bash
make up       # creates .env with random secrets, starts PostgreSQL, ledgerd and the console
              # (pulls ledgerd's published images the first time), and waits until healthy
# open http://localhost:8787
make smoke    # 17 checks through the console, including that the API key is nowhere a browser can see it
make down     # stop it (the data stays; `docker compose down -v` deletes it)
```

`make help` lists every target.

### Development

```bash
make up                 # a ledgerd to develop against (or any ledgerd you have: set LEDGERD_URL)
npm install             # exact versions from package-lock.json; Node 22.12 or newer
npm run dev             # http://localhost:5173, with hot reload
```

`npm run dev` starts the same console server as production (so the key handling you see is the
one that ships) plus Vite, which forwards `/api` to it. It reads `LEDGERD_API_KEY` from `.env`,
then from `.env.local`, which wins.

## Architecture

```mermaid
flowchart LR
    subgraph browser["Browser (anyone who can open the page)"]
        SPA["React application<br/>no key, no Authorization header"]
    end
    subgraph console["Console server (Node, Hono)"]
        CHK["Host, Origin and header checks<br/>body limit, rate limit"] --> ALLOW["allow-list of ledgerd's<br/>paths, methods and headers"]
        ALLOW --> FWD["adds Authorization<br/>from its environment"]
        CHK --> STATIC["static files<br/>strict Content Security Policy"]
    end
    SPA -->|"same origin: /api/*<br/>+ X-Ledgerd-Console"| CHK
    FWD -->|"HTTP + the API key"| L["ledgerd<br/>(release image)"]
    L --> P[("PostgreSQL")]
    KEY[["LEDGERD_API_KEY<br/>environment of the server"]] -.-> FWD
```

**Why the key stays on the server.** A web application is code that anyone can read, so a key
compiled into it is public (and a build tool such as Vite will inline an environment variable
into the bundle without complaint). The browser therefore only ever talks to the console's own
origin; the console server holds the key and adds the `Authorization` header to what it
forwards. A side effect is that there is no cross-origin request, so no CORS to configure. The
decision, what it costs, and the alternatives are in
[ADR 0001](docs/adr/0001-the-api-key-lives-on-a-server.md).

The same server serves the built application, so one container is the whole console. In
development the application is served by Vite instead, and the server is the same.

## Pages

| Page            | What it does                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview        | The connection to ledgerd: ready, not ready or unreachable, re-checked every 10 seconds. The same state is in the header of every page.                                                                |
| Accounts        | A list (newest first, with filters and "load more") and a form to create one. The form checks code and currency with ledgerd's own rules before sending, and keeps your input when ledgerd refuses it. |
| Account         | Attributes and balance, the history of postings in pages, and the balance **as of** any past moment. Postings that are only a step inside a multi-posting transaction are marked.                      |
| New transaction | A builder for 2 to 100 postings with per-currency totals, a "simple transfer" shortcut, the `Idempotency-Key` shown and editable, and a way to send the same request again.                            |
| Transactions    | Open a transaction by id; reverse it (after a confirmation that explains nothing is edited and a new offsetting transaction is made).                                                                  |
| Failure Lab     | The scenarios below. Each creates its own `lab-` accounts, shows its steps in order, and ends with a computed verdict.                                                                                 |
| Reconciliation  | A standard or deep check, its report, and the reports of this session side by side. It only reports; it never repairs.                                                                                 |
| Benchmark       | Throughput and latency of ledgerd under 10, 20 and 40 virtual users, with the environment and the ledgerd commit they were measured at, charts and equivalent tables.                                  |
| Settings        | Theme, whole minor units instead of decimals, and the decimal places of each currency. Stored in the browser only.                                                                                     |

### The Failure Lab

| Scenario                 | What it does                                                    | Behaved as designed if                                                        |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Overdraft                | fund a protected wallet with 100, withdraw 101                  | the withdrawal is refused (`insufficient_funds`) and the balance is still 100 |
| Retry                    | send a deposit twice with the same key                          | the second answer is a replay of the first, and the balance changed once      |
| Key reuse                | the same key with a different amount                            | refused (`idempotency_key_reuse`), balance unchanged                          |
| Unbalanced               | debit 100, credit 99                                            | refused (`unbalanced_transaction`), nothing recorded                          |
| Number as amount         | `"amount": 100` as a JSON number                                | refused, naming the field                                                     |
| Precision                | deposit 2^53+1, 2^63 and 10^30, then 10^30+1                    | balances equal the exact digits; the last is refused                          |
| Double reversal          | reverse a transaction twice                                     | the first succeeds, the second is `already_reversed`                          |
| Simultaneous withdrawals | 30 withdrawals of 10 against a balance of 100, started together | exactly 10 accepted, 20 refused, final balance 0                              |

A scenario is a plain function, and its verdict is computed from the checks, not asserted. How
that is tested, including against a ledger that is made to misbehave, is in
[ADR 0004](docs/adr/0004-the-failure-lab-is-tested-twice.md). Scenarios write real data to the
ledger they are connected to; the page says so and shows how many `lab-` accounts exist.

## Money

Amounts are `bigint` in the application and strings on the wire, never a `number`, so a balance
above 2^53 is shown with its exact digits. A lint rule, an architecture test, property-based
tests and the Lab's precision scenario enforce it. Decimal places are a display setting; the
ledger stores whole minor units and does not know them. Details in
[ADR 0002](docs/adr/0002-money-is-a-bigint-end-to-end.md).

## Commands

| Command                      | What it does                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `make up` / `down` / `logs`  | Start, stop and follow the compose stack                                                                               |
| `make smoke`                 | 17 checks through the running console                                                                                  |
| `make e2e`                   | The browser tests, in a pinned Playwright container, against a fresh stack that is removed afterwards (needs Docker)   |
| `make screenshots`           | Takes `docs/screenshots` the same way                                                                                  |
| `npm run dev`                | Development server with hot reload                                                                                     |
| `npm run verify`             | Everything that needs no network and no Docker: types, generated-types check, lint, format, tests, build and its scans |
| `npm run verify:ci`          | The same, with coverage and its floor; what CI runs                                                                    |
| `npm test`                   | Unit and component tests (the API is mocked; an unmocked request fails the test)                                       |
| `npm run coverage`           | The tests with coverage; fails below the floor                                                                         |
| `npm run e2e`                | The browser tests with browsers installed on this machine, against a stack started with `make up`                      |
| `npm run check:api`          | Regenerates the API types and fails if the committed file is out of date (needs the network)                           |
| `npm run audit`              | Known vulnerabilities in production dependencies (needs the network)                                                   |
| `npm run check:traceability` | Fails if the [traceability matrix](docs/traceability.md) names a test that does not exist or leaves a criterion out    |
| `npm run import:k6`          | Turns the output of ledgerd's benchmark into `data/benchmark.json` ([how](data/README.md))                             |

## Configuration

The console server is configured by environment variables. No secret has a default value in
this repository: `make env` (run by `make up`) writes `.env` with random ones.

| Variable                  | Default                                           | Meaning                                                                                          |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `LEDGERD_API_KEY`         | required                                          | Added to forwarded requests; at least 16 characters. Never logged and never sent to the browser. |
| `LEDGERD_URL`             | `http://127.0.0.1:8085`                           | Where ledgerd is. Must not contain credentials.                                                  |
| `CONSOLE_ADDR`            | `127.0.0.1:8787`                                  | Listen address. Loopback by default; the container listens on `0.0.0.0` and logs a warning.      |
| `CONSOLE_ALLOWED_HOSTS`   | `localhost:<port>,127.0.0.1:<port>`               | `Host` values it serves; anything else is refused with 421 (DNS rebinding).                      |
| `CONSOLE_ALLOWED_ORIGINS` | `http://localhost:<port>,http://127.0.0.1:<port>` | Origins allowed to `POST`; anything else is refused with 403 (cross-site request forgery).       |
| `CONSOLE_LOG_LEVEL`       | `info`                                            | `debug`, `info`, `warn` or `error`.                                                              |
| `CONSOLE_STATIC_DIR`      | `dist`                                            | Where the built application is.                                                                  |

For the compose stack (`.env`): `LEDGERD_API_KEY`, `POSTGRES_SUPERUSER_PASSWORD`,
`LEDGERD_OWNER_PASSWORD` and `LEDGERD_APP_PASSWORD` are generated; `CONSOLE_PORT` (8787) and
`LEDGERD_PORT` (8085) are published on `127.0.0.1` only. [.env.example](.env.example) explains
each. Configuration errors are reported all at once, and never print the key.

## Security model

What the console server does, each with a test that sends the offending request and checks the
refusal:

- **The key is held by the server** and appears in no response, header, URL, log line, source
  map or bundle. The build fails if the bundle contains the key, in plain, URL-encoded,
  hexadecimal or base64 form, or the code that builds an `Authorization` header.
- **An allow-list** of ledgerd's paths and methods (compared in a test with ledgerd's OpenAPI
  file) and of the headers passed in each direction. No cookies are forwarded. Anything else is
  answered `404`/`405` without contacting ledgerd. Redirects are not followed.
- **Other sites cannot use it:** a `Host` check (DNS rebinding), an `Origin` check and a required
  custom header on every write (cross-site request forgery).
- **A strict Content Security Policy** (no inline script, no other origin), `nosniff`,
  `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`; the application renders server text
  as text and a lint rule forbids `dangerouslySetInnerHTML`.
- **Limits:** request bodies up to 64 KiB, 50 requests a second per client with a burst of 200
  (`429`), 30 seconds per call (120 for reconciliation, which scans the whole ledger).
- **The container** runs as a non-root user on a distroless image with a read-only filesystem,
  no capabilities and `no-new-privileges`; images and Actions are pinned by digest or SHA.

What it does not do is in [Limitations](#limitations).

## How it is tested

| Layer          | Tool                                                   | What it proves                                                                                                                         |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Logic          | Vitest, fast-check                                     | money parsing and formatting round-trip for every amount up to 10^30; the builder's totals; the Lab's checks; error classification     |
| Components     | Vitest, Testing Library, MSW, axe-core                 | each page, its error states, keyboard use and accessibility (WCAG 2.2 AA rules), with the API mocked and any unmocked request failing  |
| Console server | Vitest, in-process and over a real socket              | allow-list, header policy, Host/Origin/CSRF refusals, rate and size limits, timeouts, key never in a response or a log                 |
| Build          | scripts in `npm run verify`                            | no inline script or style in the page; no key or `Authorization` code in the bundle; generated types current; benchmark data valid     |
| End to end     | Playwright (Chromium) with axe, against the real stack | every page in light and dark themes, colour contrast included; the flows; every Lab scenario against the real ledgerd; the screenshots |
| Dependencies   | `npm audit`                                            | no high-severity advisory in production dependencies                                                                                   |

There are over 1,300 unit and component tests and over 70 end-to-end tests. Coverage is
measured by `npm run coverage` and CI fails below a floor (95 % of statements and lines, 90 % of
branches, 93 % of functions); when it was set the figures were 96.7 %, 96.9 %, 93.5 % and
95.5 %. The floor is raised as the figures rise and never lowered to get a green run.

The tests are checked as well as run: the checkers have tests that show each rule can fail, and
many were verified by breaking the code they guard and watching a test fail. The end-to-end
tests include one that proves the accessibility check can fail.

[docs/traceability.md](docs/traceability.md) maps every acceptance criterion of the
[requirements](.kiro/specs/console/requirements.md) to the tests that verify it, or says that
none does. `npm run check:traceability` fails if it names a test that does not exist or leaves a
criterion out.

The end-to-end tests run in a Playwright container pinned by digest, on the same compose stack
as `make up`, so a failure in CI can be reproduced on a laptop with `make e2e`.

## Changing the ledgerd version

The API types are generated from ledgerd's `docs/openapi.yaml` at a pinned release
([ADR 0003](docs/adr/0003-generated-types-checked-schemas.md)). To follow a new release:

1. Change the version in the `generate:api` script in `package.json` (it is part of the URL),
   and the image tags and digests in `docker-compose.yml`.
2. `npm run generate:api`, then read the diff of `src/api/schema.d.ts`.
3. `npm run verify`. The compiler fails where a schema in `src/api/schemas.ts` no longer matches
   the contract, and the allow-list test fails if an endpoint was added or removed.
4. `make e2e` against the new images, and update the version in this README.

## Limitations

- **No login.** Anyone who can reach the console server can use the ledger through it, which is
  why it listens on loopback by default and the compose file publishes its port on `127.0.0.1`.
  Putting it on a network needs an authenticating proxy in front; that is out of scope.
- One ledgerd instance, no multi-user collaboration, and polling instead of push updates.
- The Lab's concurrency is bounded by the browser: it sends at most a few requests to one host at
  once (6 over HTTP/1.1), so "30 simultaneous" requests are fewer at the network. The page reports
  the overlap it measured. The promise it tests does not depend on it.
- The rate limit is kept in the memory of one process: it is a guard for one console, not a
  distributed quota.
- Decimal places are a presentation setting. The ledger has no notion of them.
- The benchmark page shows a snapshot from one laptop, not a live measurement and not a
  guarantee. The 40-user rows were imported from a real k6 summary; the 10- and 20-user rows come
  from ledgerd's README and have no p90 or maximum.
- The browser tests run in Chromium only. The pages use no browser-specific features, but
  Firefox and Safari are not tested.
- The screenshots come from one machine and one run; the numbers in them (times, ids) differ on
  every run.

## How it was built

Specification first, as ledgerd was: [requirements](.kiro/specs/console/requirements.md) →
[design](.kiro/specs/console/design.md) → [tasks](.kiro/specs/console/tasks.md), then the
implementation, each task finished with `npm run verify` green. The ledgerd change this console
needed (`GET /v1/accounts`, and published images) was specified and released first, as ledgerd
0.2.0.

## Layout

```
src/            the React application: api/ (client, schemas, generated types), money/,
                features/ (accounts, transactions, lab, reconciliation, benchmark, ...), ui/, app/
server/         the console server (Hono): security, allow-list, forwarding, static files
e2e/            Playwright tests and the screenshot script
scripts/        build checks, benchmark import, container/workflow/traceability checkers
data/           the benchmark data and how it was produced
docs/           architecture decision records, the traceability matrix, screenshots
.kiro/specs/    requirements, design and tasks
```

## License

[MIT](LICENSE).
