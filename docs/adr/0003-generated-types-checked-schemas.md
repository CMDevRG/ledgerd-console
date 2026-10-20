# 0003. API types are generated from the OpenAPI file, and every answer is parsed

Status: accepted

## Context

The console depends on a contract it does not own: ledgerd's HTTP API. A front end that
describes that API by hand has two ways to drift. The types can disagree with the real API
(a field renamed, a status added), and the tests can disagree with both, because a mock that
returns what the author remembered proves nothing about the real server. TypeScript types
also vanish at runtime: an answer of the wrong shape still reaches the user interface.

## Decision

- **Types are generated** from ledgerd's `docs/openapi.yaml` at a pinned release
  (`npm run generate:api`, currently v0.2.0) into `src/api/schema.d.ts`, which is committed.
  `npm run check:api` regenerates it and fails if the committed file differs, so a stale file
  fails continuous integration. `npm run check:api-types` compiles the generated file with
  library checking on, which is how the project proves the generator works with TypeScript 6.
- **Every response is parsed at runtime** by a Zod schema (`src/api/schemas.ts`). An answer
  that does not match is classified as "the response was not understood", never shown as
  data. Amounts stay strings through this layer (see ADR 0002).
- **The two descriptions are tied together at compile time** (`src/api/contract.ts`): the type
  each Zod schema accepts must be exactly the generated type (a type-equality check; the one
  exception is the problem document, where the console also accepts the extra error codes of
  its own server). If the contract changes, the build breaks where the schema must change.
- **Mocks cannot drift:** test data is built by factories typed with the generated types, and
  a test compares the console server's allow-list with the generated `paths`. An unmocked
  request fails the test.
- Failures are classified, not dumped: the server refused (problem code, title, detail, request
  id), the service is busy (503, with the suggested wait), the network failed, or the answer was
  not understood.

## Consequences

- Two descriptions of each shape (the generated type and the Zod schema), checked against each
  other by the compiler. That duplication is deliberate: one is the contract, the other is the
  runtime guard, and the compiler keeps them equal.
- Updating for a new ledgerd release is a short, mechanical procedure: change the version in
  the `generate:api` script, run it, read the diff of `schema.d.ts`, and fix what the compiler
  and the contract check point at. The README lists the steps.
- The generator is fetched from the network, so `check:api` is run in continuous integration
  and not in the offline `npm run verify`.
- `openapi-typescript` declares `typescript@^5`; an `overrides` entry lets it use 6, and
  `check:api-types` is what makes that safe.

## Alternatives considered

- **Hand-written types:** the drift this ADR exists to prevent.
- **Schemas generated from the OpenAPI file** (a tool that emits Zod): attractive, and a
  candidate for later. It was not chosen because the hand-written schemas also carry decisions
  the OpenAPI file cannot express (an amount is a digit string that becomes a `bigint`; an
  unknown problem code is still a problem), and the compile-time check gets most of the benefit
  with less machinery.
- **Trusting the answer** (types only): a wrong shape would surface as a wrong number on
  screen.
