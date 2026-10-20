# Architecture decision records

Short notes on the decisions that shaped the console, why they were made, and what they
cost. Each one is written so that a reader can disagree with it knowingly. The full list of
design decisions, with their rationale, is in
[the design document](../../.kiro/specs/console/design.md#key-decisions).

| #                                               | Decision                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| [0001](0001-the-api-key-lives-on-a-server.md)   | A small server holds the API key, and the browser only ever talks to it            |
| [0002](0002-money-is-a-bigint-end-to-end.md)    | Money is a `bigint` end to end, and a string on the wire                           |
| [0003](0003-generated-types-checked-schemas.md) | API types are generated from the OpenAPI file, and every answer is parsed          |
| [0004](0004-the-failure-lab-is-tested-twice.md) | The Failure Lab is plain functions, tested against a fake and against the real API |
