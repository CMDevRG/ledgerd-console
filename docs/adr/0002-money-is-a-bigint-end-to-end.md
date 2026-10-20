# 0002. Money is a `bigint` end to end, and a string on the wire

Status: accepted

## Context

JavaScript's `number` is a 64-bit float. It represents every integer only up to 2^53
(9,007,199,254,740,992), and silently rounds above it. ledgerd's amounts go up to 10^30 minor
units, because an 18-decimal asset such as ether needs 10^18 units for one ether. A console that
reads one of those through `number`, even for display, would show a wrong balance without any
error, and a display that lies about money is worse than no display.

ledgerd already sends amounts as JSON strings of digits for the same reason (its
[ADR 0001](https://github.com/CMDevRG/ledgerd/blob/main/docs/adr/0001-exact-integer-money.md)).

## Decision

- Amounts and balances are `bigint` in the application, and strings in requests and responses.
  They are validated as digit strings when parsed, and converted once.
- **No amount ever becomes a `number`.** This is enforced three ways, because a convention
  that only code review upholds is not a rule:
  - an ESLint rule forbids `parseFloat` everywhere in the application, and `Number`,
    `parseInt` and `Math` inside the money module;
  - an architecture test fails if any file of the money module calls `Number`, `parseFloat`,
    `parseInt` or `Math` on an amount;
  - the Failure Lab runs the precision scenario (2^53 + 1, 2^63, 10^30, and 10^30 + 1 refused)
    against the real ledger in a real browser.
- **Parsing and formatting are exact and strict.** `parseAmount(text, scale)` accepts `1` and
  `1.50`; it rejects signs, exponents, thousands separators, padding, a comma as the decimal
  separator, more decimals than the currency's scale, zero, and values above 10^30, and the
  error says which. `formatAmount` prints the exact digits.
- **The display scale is a presentation setting**, not part of the ledger. USD and EUR show 2
  decimals, JPY 0, USDT and USDC 6, BTC 8, ETH 18; the user can change it per currency
  (stored in the browser, never sent anywhere), or switch any view to raw minor units.
- Property-based tests (fast-check) check, for any value from 1 to 10^30 and any scale from
  0 to 18, that `parse(format(x)) === x`, and that invalid input is rejected.

## Consequences

- Exact digits everywhere, including values above 2^53 and 2^63.
- A formatting layer is needed for display, and every amount in a component goes through the
  `Amount` component, which also gives negatives an explicit sign and a text label instead of
  relying on colour.
- Code that handles amounts cannot use the usual numeric helpers; it uses `bigint`
  arithmetic and the helpers of the money module. That is the intended friction.
- Charts and anything else that needs a `number` (the benchmark view) use data that is not
  money: throughput and latency.

## Alternatives considered

- **A decimal library** (`big.js`, `decimal.js`): it is not needed, because there are no
  fractions in the ledger. The fraction exists only in the display, and a string operation on
  the digits is enough.
- **`number` with a range check** ("refuse above 2^53"): it would make the console unable to
  show what the ledger can hold, which is the point of the precision scenario.
- **Strings only, with no arithmetic:** the builder needs exact sums to show per-currency
  totals while the user types.
