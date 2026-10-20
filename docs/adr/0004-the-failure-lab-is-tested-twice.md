# 0004. The Failure Lab is plain functions, tested against a fake and against the real API

Status: accepted

## Context

The Failure Lab runs scenarios that try to break the ledger (overdraft, retry, key reuse,
unbalanced transaction, a number where a string belongs, precision limits, double reversal,
simultaneous withdrawals) and says whether the ledger behaved as designed. A tool whose
output is a verdict has a particular risk: a verdict that is wrong in the comfortable
direction. A scenario that always says "behaved as designed" looks exactly like one that works,
and it would present a broken ledger as a correct one.

## Decision

- **A scenario is a pure `async` function** over an injected `LabApi`
  (`send(request) → Exchange`), which does not throw on HTTP errors and records the request
  and the response of every call. The UI renders that recording generically: steps, each
  request and response, the checks with expected and actual values, and the verdict.
- **The verdict is computed, not asserted.** It is "behaved as designed" only if every check
  passed. A network failure is "could not run", never "behaved as designed". An unexpected
  outcome is shown prominently.
- **Every scenario is tested against two things:**
  1. **A fake in-memory ledger** (`src/test/ledgerSim.ts`) that implements the rules, and the
     same fake **with a deliberate fault switched on** (overdraft allowed, or applied before it is
     refused; idempotency ignored; a reused key accepted; the balance check skipped; a number
     accepted as an amount; no amount limit; amounts that pass through a float; a double
     reversal allowed; a stale balance check under concurrency). The scenario must pass on the correct fake and **fail on the faulty one**.
     This is what shows that each check can fail, and that the verdict is not a rubber stamp.
  2. **The real ledgerd, in a real browser**, in the end-to-end suite: all eight scenarios must
     report "behaved as designed".
- The browser never has the API key, so a recorded exchange cannot contain it; a test asserts
  that no recorded header is `authorization`.
- Lab data cannot touch the user's: every scenario creates its own accounts with the prefix
  `lab-`, and the Lab shows how many exist and warns that it writes real data.
- **The concurrency scenario states its limit.** A browser sends only a few requests to one
  host at once (6 over HTTP/1.1), so 30 "simultaneous" withdrawals are not 30 at the network.
  The scenario measures the overlap it actually got from the browser's own timings and shows
  it. The promise it tests does not depend on the overlap: with any concurrency, the ledger
  must never accept more than the balance pays for.

## Consequences

- Each scenario needs its expected outcome written down, and a fault in the fake that breaks
  it. That is about as much code as the scenario, and it is the part that makes the Lab
  trustworthy.
- The fake and the real ledger can disagree. That is a finding, not a failure of the method:
  the end-to-end run is what keeps the fake honest. Its answers also go through the same Zod
  schemas as the real ones, so they cannot have a shape the contract does not allow.
- The Lab shows only what the ledger did. It does not claim anything about conditions it could
  not create, and the README says so.

## Alternatives considered

- **Test the Lab only end to end:** it proves the happy path against the real ledger, but not
  that a check can fail, because the real ledger does not misbehave on request.
- **Hard-code the expected result in the UI:** a verdict that is displayed and not computed
  cannot be tested.
- **A mock server with canned answers:** it would test the scenario against what its author
  expected, which is the case that proves least.
