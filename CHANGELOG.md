# Changelog

Versions follow [Semantic Versioning](https://semver.org). Published versions are never changed.

## 0.1.0

First release. A web console for [ledgerd](https://github.com/CMDevRG/ledgerd) 0.2.0.

### Added

- **Pages:** connection status; accounts (list with filters and paging, create); account detail
  with history, balance now and as of a past moment; a transaction builder with per-currency
  totals; idempotency made visible (the key, a repeat that is a replay); transaction lookup and
  reversal; reconciliation with the reports of the session; a benchmark page with charts and
  their tables; settings (theme, decimal places per currency).
- **Failure Lab:** eight scenarios that try to break the ledger (overdraft, retry, key reuse,
  unbalanced transaction, a number as an amount, precision up to 10^30, double reversal, thirty
  simultaneous withdrawals), each showing every request and response and ending in a computed
  verdict.
- **Console server** (Node, Hono): holds the API key and forwards a tested allow-list of
  ledgerd's calls; Host, Origin and custom-header checks; a strict Content Security Policy; body
  and rate limits; graceful shutdown; health endpoints.
- **Money** as `bigint` end to end, never a `number`.
- **Tooling:** API types generated from ledgerd's OpenAPI file; a one-command stack
  (`make up`) from ledgerd's published images; a Playwright suite in a pinned container; a
  smoke test; GitHub Actions pinned by SHA; Dependabot.
- **Documentation:** README with screenshots taken by the end-to-end run, four architecture
  decision records, and a traceability matrix from every acceptance criterion to its tests, with
  checkers that fail when the documentation drifts.

### Known limitations

See the README: no login (loopback only by default), one ledgerd instance, browser-bound
concurrency in the Lab, Chromium-only browser tests, and a benchmark snapshot from one machine.
