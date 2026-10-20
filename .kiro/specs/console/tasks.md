# Implementation Plan — ledgerd console

Conventions, as in ledgerd: each task builds on the previous and leaves the repository
passing `npm run verify`; each lists the requirements it satisfies and how it is verified;
"done" means code, tests, lint, a commit.

**Phase 0 is in the ledgerd repository**: tasks 33–37 of
`ledgerd/.kiro/specs/account-listing` (the list endpoint and release images, version 0.2.0).
Console tasks that need them say so.

---

## Phase 1 — Foundations

- [x] 1. Repository scaffold (Vite, React, TypeScript, Tailwind, TanStack Query, Vitest, MSW, ESLint, Prettier, contract types)
- [x] 2. Test and build tooling
  - Add fast-check, axe-core, Hono, esbuild, tsx; split Vitest into a `client` project (jsdom) and a `server` project (node); a second `tsconfig` for the server; scripts `verify`, `coverage`.
  - Verify: `npm run verify` runs both projects.
  - _R16.1, R16.6_
- [x] 3. Money module
  - `parseAmount`, `formatAmount`, scales, errors; the lint rule against float conversions; the architecture test that greps `src/money`.
  - Verify: unit tests for every rejection; property tests for round trips from 1 to 10^30 and scales 0 to 18.
  - _R5.1–R5.5_
- [x] 4. API layer
  - Regenerate types from ledgerd 0.2.0; Zod schemas for every response with the compile-time equality checks; the HTTP client (prefix, custom header, timeouts, four error kinds); typed test factories; query hooks.
  - Verify: tests for each error kind and for a response that does not match its schema; type checks fail when a schema is changed on purpose.
  - Needs ledgerd tasks 33–35.
  - _R12.1, R16.4_

## Phase 2 — Console server

- [x] 5. Server skeleton
  - Configuration with the redacted key type, JSON logging, request ids, `/healthz` and `/readyz`, graceful shutdown.
  - Verify: tests for every configuration error (the key never printed), health endpoints, shutdown with a request in flight.
  - _R2.4, R2.5, R17.5, R17.6_
- [x] 6. Security pipeline
  - Host check, rate limit (token bucket with an injectable clock), security headers and CSP, body limit, the custom-header and Origin/`Sec-Fetch-Site` checks.
  - Verify: one hostile-request test per defence (wrong Host, cross-origin POST, POST without the header, oversized body, burst over the limit).
  - _R15.1, R15.2, R15.3, R15.5, R15.8_
- [x] 7. Allow-list and forwarding
  - The route table and its comparison with the generated `paths`; header allow-lists in both directions; `Location` rewriting; translation of ledgerd `401` to `502` and of network failures to `504`; per-route timeouts; no cookies.
  - Verify: tests against a fake ledgerd for every route, every header rule and every translation; a test that the key appears in no response, header or log line.
  - _R2.1–R2.3, R15.6_
- [x] 8. Static files and the development runner
  - Serve `dist/` with a single-page fallback that does not swallow missing assets; `npm run dev` runs Vite and the server together, with Vite forwarding `/api`.
  - Verify: tests for the fallback rules; the dev runner starts both and a request through Vite reaches the fake ledgerd.
  - _R17.2_

## Phase 3 — Application shell and pages

- [x] 9. Shell and UI primitives
  - Router with lazy routes, layout with landmarks, error boundary, live region, theme (external script), settings page with display scales; `Field`, `Button`, `Table`, `Dialog`, `CopyText`, `Amount`, `Time`, error components.
  - Verify: component tests with axe for each primitive; keyboard tests; the error boundary test.
  - _R12.2–R12.5, R13, R14_
- [x] 10. Connection status
  - Indicator and overview page on `/api/readyz`, with the explanatory states.
  - _R1_
- [x] 11. Accounts: list and create
  - Infinite list, filters in the URL, empty state, the form with client-side rules, server field errors, suggested normal balance.
  - Needs ledgerd 0.2.0.
  - _R3_
- [x] 12. Account detail
  - Attributes and balance with polling, as-of control and URL state, history with "load more", the note on intermediate rows.
  - _R4_
- [x] 13. Transaction builder
  - Reducer and selectors (property-tested), the editor, live per-currency totals, the unbalanced warning, submission, result view with balances after.
  - _R6_
- [x] 14. Idempotency panel and reversal
  - Key display and editing, "send the same request again", replay explanation, key-reuse and "key not consumed" messages; transaction page, lookup by id, reversal dialog.
  - _R7, R8_

## Phase 4 — Failure Lab, reconciliation, benchmark

- [x] 15. Failure Lab core
  - Types, the recording API wrapper, the runner UI and exchange viewer, a fake in-memory ledger implementing the rules. Scenario a (overdraft) was built with it, to prove the whole path with a real scenario; the sim gained switchable faults so checks can be shown to fail.
  - _R9.2–R9.4, R9.6, R9.7_
- [x] 16. Scenarios b to g
  - One pure function each (a is done), with a test against the fake ledger and a test with a deliberately wrong fake proving each check can fail.
  - _R9.1_
- [x] 17. Scenario h (concurrency)
  - Parallel requests, in-flight counter, the explanation about browser limits.
  - _R9.1, R9.5_
- [x] 18. Reconciliation page
  - Run, progress, report, mismatch and chain-break tables, session history and comparison, stale-report protection.
  - _R10_
- [x] 19. Benchmark view
  - Data file with schema and checker, the k6 importer, `SvgBarChart` with accessible tables, the page and its explanations.
  - _R11_

## Phase 5 — Quality, packaging, release

- [x] 20. Build checks
  - Server bundle with esbuild; the canary-key scan of the emitted files; the inline script and style check; `npm audit` gate.
  - _R2.6, R15.4, R15.7_
- [x] 21. Container and compose
  - Dockerfile (distroless Node, non-root, read-only), `docker-compose.yml` with the pinned ledgerd release images, `make up` creating `.env`, a smoke script.
  - Needs ledgerd 0.2.0 images.
  - _R17.1, R17.3, R17.4_
- [x] 22. End-to-end suite
  - Playwright, run in the pinned Playwright container (`make e2e`) because the browser's system libraries need `sudo`, which an unattended session does not have; CI installs them with `--with-deps`. axe on every page, flows: accounts, deposit, overdraft, replay, reversal, as-of, paging, reconciliation.
  - _R16.3, R13.7_
- [x] 23. End-to-end: Lab and screenshots
  - Every scenario against the real ledgerd; the screenshot script.
  - _R9, R18.3_
- [ ] 24. Continuous integration
  - Workflow with pinned Actions: verify, audit, end-to-end against the compose stack, screenshots as an artifact; Dependabot.
  - _R16.5_
- [ ] 25. Documentation
  - README with screenshots and diagrams, the four ADRs, the traceability matrix and its checker.
  - _R16.7, R18_
- [ ] 26. Final review and release
  - Secrets and personal-data search, TODO search, full clean-clone run, publish `CMDevRG/ledgerd-console`, tag `v0.1.0`.

## Ideas for later (not v1)

- A read-only public demo mode with rate limiting and periodic reset.
- A live view that streams new postings (needs a ledgerd event feed, i.e. the outbox).
- A "tamper and detect" demo (needs a safe way to alter data for the demo database only).
