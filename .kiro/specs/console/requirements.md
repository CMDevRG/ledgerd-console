# Requirements Document — ledgerd console

## Introduction

The console is a web application for [ledgerd](https://github.com/CMDevRG/ledgerd), a
double-entry accounting ledger with an HTTP API. It lets a person **use** the ledger
(accounts, balances, history, transfers, reversals), **try to break it on purpose**
(overdraft, duplicate request, unbalanced transaction, precision limits, concurrency),
and **see it prove itself** (reconciliation, benchmark results).

Its purpose is twofold: to make the guarantees of ledgerd visible to someone who does not
read Go or SQL, and to be a well-engineered front end in its own right: typed against the
API contract, accessible, secure around a financial API, and tested at every level.

This document uses the EARS notation. Each requirement has a user story and numbered
acceptance criteria, and each criterion must be verifiable by an automated test, a
documented manual check, or an inspection stated in the criterion.

### Glossary

- **ledgerd**: the API the console talks to. Version 0.1.0 plus the change in R3.
- **Console server**: a small server that is part of this project. It serves the web
  application and forwards API calls to ledgerd, adding the API key. The browser talks only to it.
- **Minor units**: ledgerd's whole-number amounts (cents, wei, ...). Always strings in JSON.
- **Display scale**: how many decimal places a currency shows in the UI (for example
  USD 2, ETH 18). A presentation choice; ledgerd does not know it.
- **Lab account**: an account created by a scenario in the Failure Lab, with a code that
  starts with `lab-`.

### Scope

In scope (v1): a local-first console for a single ledgerd instance. Connection status;
accounts (list, create, detail); balances, history and historical balances; a transaction
builder with multiple postings; idempotency made visible; reversal; transaction lookup;
the Failure Lab; reconciliation; the benchmark results view; accessibility; security of
the browser-to-API path; automated tests including end-to-end tests against a real
ledgerd; one-command local setup; documentation.

Out of scope for v1: user accounts and login for the console itself, multi-tenant or
multi-instance use, a public internet deployment, editing or deleting data (ledgerd is
append-only), real-time push updates (polling only), translations (the UI is in English),
a native mobile app.

### Dependency on ledgerd

ledgerd 0.1.0 has no endpoint that lists accounts, and a console that can only open an
account whose id it already knows is not usable. R3.1 therefore requires a **new
ledgerd endpoint** (`GET /v1/accounts`). It is specified and built in the ledgerd
repository (release 0.2.0) before the console work that depends on it.

---

## Requirements

### Requirement 1: Connection status

**User Story:** As a user, I want to know at a glance whether the ledger is reachable and ready, so that I do not mistake an outage for an empty ledger.

#### Acceptance Criteria

1. The console SHALL show on every page whether ledgerd is *ready*, *not ready*, or *unreachable*, using ledgerd's `/readyz`.
2. WHILE the console is open, it SHALL re-check readiness periodically (every 10 seconds) and update the indicator without a page reload.
3. WHEN ledgerd answers with a problem document or with a body that does not match the documented shape, the console SHALL NOT show *ready*.
4. WHEN readiness changes, the new state SHALL be announced to assistive technology without moving focus.
5. WHEN ledgerd is not ready or unreachable, pages that need it SHALL show a clear, non-technical explanation and a retry action instead of an empty or broken view.

### Requirement 2: The API key never reaches the browser

**User Story:** As an operator, I want the API key kept out of the browser, so that anyone using or inspecting the page cannot read or reuse it.

#### Acceptance Criteria

1. The API key SHALL be read by the console server from its environment and SHALL NOT appear in the served HTML, JavaScript bundle, source maps, any HTTP response body or header sent to the browser, any URL, local storage, or log output.
2. The console server SHALL add the `Authorization` header to forwarded requests itself; the browser SHALL NOT send one.
3. The console server SHALL forward only an explicit allow-list of ledgerd paths and methods (the endpoints the console uses) and SHALL answer any other request with `404` or `405` without contacting ledgerd.
4. The console server SHALL refuse to start if the API key is missing or shorter than 16 characters, and SHALL report the problem without printing the key.
5. By default the console server SHALL listen only on the loopback interface.
6. A build-time check SHALL fail if the string of the configured API key appears anywhere in the production bundle.

### Requirement 3: Accounts — list and create

**User Story:** As a user, I want to see the accounts in the ledger and create new ones, so that I can set up scenarios.

#### Acceptance Criteria

1. The console SHALL list accounts using ledgerd's account-listing endpoint, newest first, with code, currency, type, normal balance, whether it may go negative, and current balance, loading further pages on request (cursor-based "load more").
2. WHEN there are no accounts, the list SHALL show an empty state that explains what an account is and offers to create one.
3. The console SHALL let the user filter the loaded accounts by code and by currency.
4. The account form SHALL collect code, currency, type, normal balance and the allow-negative flag, and SHALL validate them client-side with the same rules as ledgerd (code alphabet and length, asset code format) before sending.
5. WHEN ledgerd rejects the form, the console SHALL show each field error next to its field and the summary in an alert region, and SHALL keep the user's input.
6. WHEN an account is created, the console SHALL show it in the list and offer to open it.
7. WHEN the user picks an account type, the console SHALL suggest the conventional normal balance (DEBIT for assets and expenses, CREDIT for liabilities, equity and income) without forcing it.

### Requirement 4: Account detail, balances and history

**User Story:** As a user, I want to inspect an account's balance and history, including what the balance was at a past moment.

#### Acceptance Criteria

1. The account page SHALL show the account's attributes and current balance and SHALL refresh it periodically and after any transaction the console submits.
2. The history SHALL list postings newest first with transaction (as a link), direction, amount, balance after, and time, loading further pages with a cursor, without repeating or skipping postings that existed when the first page was read.
3. The user SHALL be able to enter a date and time and see the balance as of that instant (ledgerd's `as_of`), with the instant and the answer clearly labelled and a way to return to the current balance.
4. WHEN the entered instant is malformed or the server rejects it, the console SHALL show the field error instead of a stale answer.
5. WHEN an account has no postings, the history SHALL say so rather than show an empty table.
6. The page SHALL make clear which postings are intermediate rows of a multi-posting transaction (several postings on the same account in one transaction), because their running balance is not a committed state.

### Requirement 5: Money is exact

**User Story:** As a user, I want every amount to be shown and entered exactly, so that the console never lies about money.

#### Acceptance Criteria

1. The console SHALL represent all amounts and balances as `BigInt` or strings and SHALL NOT convert any amount to a floating-point `number` at any point; a lint rule SHALL forbid the obvious ways of doing so.
2. Amounts SHALL be displayed in major units using the display scale of the currency (for example `100.00 USD`) with the exact digits, and the user SHALL be able to switch any view to show raw minor units.
3. The display scale SHALL default to a built-in table for common currencies and SHALL be configurable per currency by the user (stored in local storage, never sent to the server).
4. Amount inputs SHALL accept a decimal number in major units and convert it to minor units exactly; WHEN the input has more decimals than the display scale, is negative, zero, not numeric, or exceeds 10^30 minor units, the console SHALL reject it with a specific message before any request is sent.
5. Formatting and parsing SHALL round-trip for every valid amount, including amounts above 2^53, above 2^63 and up to 10^30, verified by property-based tests.
6. Balances that are negative (on accounts that allow it) SHALL be shown with an explicit sign and not rely on colour alone.

### Requirement 6: Transaction builder

**User Story:** As a user, I want to compose a transaction of several postings and see that it balances before I send it, so that I understand double entry.

#### Acceptance Criteria

1. The builder SHALL let the user add and remove postings (2 to 100), choosing for each an account, a direction (DEBIT or CREDIT) and an amount, and SHALL provide a "simple transfer" shortcut that creates one debit and one credit of the same amount.
2. WHILE the user edits, the builder SHALL show, per currency, the total debits, the total credits and the difference, and SHALL indicate clearly whether the transaction is balanced.
3. The builder SHALL derive each posting's currency from its account, and SHALL prevent mixing an account and a different currency.
4. WHEN the transaction is unbalanced, the console SHALL still allow the user to send it (so that the server's refusal can be seen), but SHALL warn first; the Failure Lab is the intended place for deliberate mistakes.
5. WHEN the server accepts the transaction, the console SHALL show the resulting transaction with its postings and the balance after each, and SHALL update the affected accounts.
6. WHEN the server rejects it, the console SHALL show the error code, title and detail, the field errors against the posting rows they refer to, and the request id, and SHALL keep the form contents.
7. The builder SHALL disable submission while a request is in flight, so that a double click does not send two requests.

### Requirement 7: Idempotency made visible

**User Story:** As a user, I want to see how a retried request behaves, so that I trust that a retry never duplicates money.

#### Acceptance Criteria

1. Each submission SHALL carry an `Idempotency-Key`; the console SHALL generate a UUID by default and SHALL display the key used, with an option to edit it before sending.
2. After a write completes, the console SHALL offer "Send the same request again" that repeats it with the same key and body.
3. WHEN the server answers a repeat with the original result (`Idempotent-Replayed: true`), the console SHALL say that it was a replay, show that the balance did not change, and link to the original transaction.
4. WHEN the same key is sent with a different body, the console SHALL show the server's `idempotency_key_reuse` refusal.
5. WHEN a write fails with a refusal (for example insufficient funds), the console SHALL tell the user that the key was not consumed and that the same key may be used again.

### Requirement 8: Reversal and transaction lookup

**User Story:** As a user, I want to open any transaction and reverse it, so that I can see how corrections work in an append-only ledger.

#### Acceptance Criteria

1. The console SHALL provide a page for a transaction (by id) showing its description, time, postings, and, when present, a link to the transaction it reverses.
2. The user SHALL be able to look up a transaction by pasting its id; a malformed id SHALL be rejected with a message before any request is sent.
3. The transaction page SHALL offer "Reverse", which asks for confirmation explaining that the original will not be changed and that a new offsetting transaction will be created.
4. WHEN a reversal is accepted, the console SHALL link the new transaction and update the balances shown.
5. WHEN a reversal is refused (already reversed, insufficient funds, unknown transaction), the console SHALL show the specific reason.

### Requirement 9: Failure Lab

**User Story:** As a learner or reviewer, I want guided scenarios that try to break the ledger and show what happens, so that I can see its guarantees working.

#### Acceptance Criteria

1. The Failure Lab SHALL offer these scenarios, each runnable with one action: (a) overdraft is refused and nothing changes; (b) a retried request is a replay, not a second effect; (c) the same key with a different body is refused; (d) an unbalanced transaction is refused; (e) an amount sent as a JSON number is refused; (f) amounts at 2^53+1, 2^63 and 10^30 are stored exactly, and 10^30+1 is refused; (g) a transaction cannot be reversed twice; (h) many simultaneous withdrawals against a balance succeed exactly as many times as the balance allows.
2. Each scenario SHALL create its own lab accounts (code prefix `lab-`) so it never touches the user's other data, and SHALL show its steps in order.
3. For each step the Lab SHALL show the request sent (method, path, body, key; never the API key) and the response received (status, headers of interest, body), plus a plain-language explanation of why that is the correct outcome.
4. Each scenario SHALL end with a verdict, *behaved as designed* or *unexpected*, computed by comparing the observed outcome with the expected one; an unexpected outcome SHALL be shown prominently, not hidden.
5. Scenario (h) SHALL send its requests concurrently, SHALL report how many were accepted and refused and the final balance, and SHALL state that browser connection limits bound the concurrency actually achieved.
6. The Lab SHALL warn that scenarios write real data to the connected ledger, and SHALL show how many lab accounts exist.
7. The scenarios SHALL be implemented as pure, testable functions over an API client, so they can be exercised against a mock and against a real ledgerd.

### Requirement 10: Reconciliation

**User Story:** As an operator, I want to ask the ledger to verify itself and read the result, so that I can see that stored balances match the postings.

#### Acceptance Criteria

1. The reconciliation page SHALL run a standard or a deep reconciliation on demand and SHALL show progress while it runs and the time it took.
2. The report SHALL show an overall verdict, the number of accounts checked, a table of balance mismatches (account, stored, expected), the debit and credit totals per currency with whether they balance, and, for a deep run, the balance-chain breaks.
3. WHEN there are mismatches or chain breaks, the verdict SHALL say so prominently and each row SHALL link to the account.
4. The console SHALL keep the reports of the current session and let the user compare them.
5. WHEN a reconciliation request fails or times out, the console SHALL show the failure and SHALL NOT display a previous report as if it were current.
6. The page SHALL explain in plain language what a reconciliation checks and that it only reports and never repairs.

### Requirement 11: Benchmark results

**User Story:** As a reader, I want to see how ledgerd performs, with the conditions it was measured under, so that I can judge the numbers fairly.

#### Acceptance Criteria

1. The benchmark page SHALL present the results from a versioned data file in this repository: scenarios, virtual users, transfers per second, latency percentiles (p50, p90, p95, p99), and failure rate, as a table and as charts.
2. The page SHALL show, next to the results, the environment (hardware, operating system, container runtime, PostgreSQL version, configuration), the ledgerd commit they were measured at, and the date.
3. The page SHALL state that the numbers come from one machine and are not guarantees, and SHALL explain in plain language the difference between the *spread* and *hot account* scenarios.
4. The data file SHALL be validated against a schema at build time and at load time; an invalid file SHALL fail the build.
5. The repository SHALL include a documented, scripted way to produce the data file from the output of ledgerd's `make bench`.
6. Every chart SHALL have an accessible equivalent (a data table or text summary).

### Requirement 12: Errors and loading states

**User Story:** As a user, I want clear feedback when something goes wrong or takes time, so that I always know what happened.

#### Acceptance Criteria

1. Every API failure SHALL be classified and shown as one of: the server refused the request (with the problem's code, title, detail and request id), the service is busy (503, with the suggested wait), the network failed, or the response was not understood.
2. The request id of a failed call SHALL be visible and copyable.
3. The console SHALL never show a raw stack trace, a raw JSON dump as the only message, or a generic "something went wrong" without a next step.
4. Every view that loads data SHALL show a loading state, and SHALL keep showing previous data while it refreshes in the background, marking it as refreshing.
5. An uncaught rendering error SHALL be caught by an error boundary that offers to reload that part of the page and does not lose the rest of the application.
6. WHEN a request exceeds a reasonable time (30 seconds), the console SHALL cancel it and say so.

### Requirement 13: Accessibility

**User Story:** As a user who relies on a keyboard or a screen reader, I want the console to be fully usable, so that the ledger is not only for mouse users.

#### Acceptance Criteria

1. The console SHALL target WCAG 2.2 level AA.
2. Every interactive element SHALL be reachable and operable by keyboard alone, in a logical order, with a visible focus indicator.
3. Every form control SHALL have a programmatically associated label; validation errors SHALL be associated with their field and announced.
4. Status changes and results of actions (readiness, success, refusal) SHALL be announced through live regions without stealing focus.
5. Information SHALL NOT be conveyed by colour alone, and text and interface contrast SHALL meet AA in both light and dark themes.
6. The console SHALL respect the user's reduced-motion preference.
7. Automated accessibility checks (axe) SHALL run on every page in component tests and in the end-to-end tests, and a page with a violation SHALL fail the test.
8. Each page SHALL have a unique, descriptive title and a single top-level heading, and navigation SHALL use landmark regions.

### Requirement 14: Responsive layout and appearance

**User Story:** As a user, I want the console to work on my laptop and my phone and to match my system theme.

#### Acceptance Criteria

1. The layout SHALL work without horizontal scrolling of the page from 360 px wide to large desktop screens; wide tables SHALL scroll inside their own container.
2. The console SHALL follow the operating system's light or dark preference and SHALL let the user override it, remembering the choice locally.
3. Long identifiers (UUIDs, cursors) SHALL be shown truncated with the full value available and copyable, never breaking the layout.

### Requirement 15: Security of the browser-to-API path

**User Story:** As an operator running the console on a machine that also browses the web, I want other websites and other machines unable to use the console's access to the ledger.

#### Acceptance Criteria

1. The console server SHALL reject any request whose `Host` header is not one of the hosts it is configured to serve, as a defence against DNS rebinding.
2. The console server SHALL reject any state-changing request (`POST`) whose `Origin` header is present and is not its own origin, and any `POST` that lacks both a JSON content type and a custom header the application sends, as a defence against cross-site request forgery.
3. The console server SHALL send a Content Security Policy that forbids inline scripts and any script, style or connection source other than itself, together with `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
4. The application SHALL render all server-provided text as text; it SHALL NOT use `dangerouslySetInnerHTML` or equivalent, and a lint rule SHALL forbid it.
5. The console server SHALL limit request body size and apply a per-client rate limit to forwarded requests, answering excess requests with `429`.
6. The console server SHALL NOT forward cookies, and SHALL NOT forward any request header other than a short allow-list.
7. Dependencies SHALL be checked for known vulnerabilities in continuous integration, and the build SHALL fail on a high-severity advisory in a production dependency.
8. Each of criteria 1, 2, 3, 5 and 6 SHALL be verified by an automated test that sends the offending request and asserts the refusal.

### Requirement 16: Verification

**User Story:** As a reviewer, I want automated proof that the console works, so that I can trust it without clicking through it.

#### Acceptance Criteria

1. The project SHALL include unit tests for pure logic (money parsing and formatting, scenario evaluation, API classification) and component tests for each page, with the API mocked and any unmocked request failing the test.
2. The project SHALL include property-based tests for the money functions (round trip; no value passes through `number`; rejection of invalid input).
3. The project SHALL include end-to-end tests in a real browser against a real ledgerd, covering at least: create accounts, deposit, overdraft refusal, idempotent replay, reversal, historical balance, history paging, every Failure Lab scenario, and reconciliation.
4. The API types SHALL be generated from ledgerd's OpenAPI file, a stale generated file SHALL fail the build, and the mocks used in tests SHALL be checked against the same contract so they cannot drift from the real API.
5. Continuous integration SHALL run type checking, linting, formatting, the unit and component tests, the production build with the secret check of R2.6, the dependency audit, and the end-to-end tests against a ledgerd started from a pinned release.
6. The test suites SHALL be run with coverage; coverage SHALL be reported and SHALL NOT silently fall below a stated threshold.
7. A traceability matrix SHALL map every acceptance criterion to the tests that verify it, and a script SHALL fail if the matrix names a test that does not exist.

### Requirement 17: Setup and operation

**User Story:** As a reviewer, I want to run everything with one command, so that I can evaluate the console in minutes.

#### Acceptance Criteria

1. A single documented command SHALL start ledgerd (built from a pinned release of its repository) with its database, and the console, and wait until both are healthy.
2. A development mode SHALL run the web application with hot reload against a running ledgerd, with the same server-side key handling as production.
3. Configuration SHALL be by environment variables, documented in a table, with no secret having a default value in the repository; a command SHALL generate local secrets.
4. All container images, tools and dependencies SHALL be pinned.
5. The console server SHALL shut down gracefully on SIGTERM, finishing in-flight requests within a bounded time.
6. The console server SHALL expose a health endpoint for container health checks.

### Requirement 18: Documentation

**User Story:** As a reader, I want to understand what this is, why it was built this way, and how to run it.

#### Acceptance Criteria

1. The README, in English, SHALL describe the purpose, include screenshots of each page, an architecture diagram that shows why the API key stays on the server, a quick start, the commands, the test strategy, the security model, and the limitations.
2. Architecture decision records SHALL document at least: why the API key is held by a server, the money-handling rule, the choice of generated API types, and how the Failure Lab is tested.
3. Screenshots SHALL be produced by the end-to-end test run, so they cannot go stale.
4. The documentation SHALL state which ledgerd version the console requires and how to update the generated types when the API changes.

---

## Decisions I need from you before the design

1. **Add `GET /v1/accounts` to ledgerd** (release 0.2.0, with its own spec, tests and OpenAPI entry), as R3.1 requires. The alternative is for the console to remember only the accounts it created itself, which makes it much less useful.
2. **UI language: English**, to match the repositories (translations are out of scope).
3. **Multi-posting builder in v1** (R6). It is more work than a two-field transfer form, but it is what makes double entry visible.
4. **The eight Failure Lab scenarios** (R9.1). Say if you want to add or drop any.
