import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ReconciliationReport } from '../../api/schemas';
import { compareReports } from './compare';

type Report = ReconciliationReport;
const report = (over: Partial<Report> = {}): Report => ({
  started_at: '2026-10-13T15:04:05.123456Z',
  deep: false,
  ok: true,
  accounts_checked: 2,
  mismatches: [],
  currencies: [{ currency: 'USD', debits: 10000n, credits: 10000n, balanced: true }],
  chain_breaks: [],
  ...over,
});
const mismatch = (id: string, stored: bigint, expected: bigint): Report['mismatches'][number] => ({
  account_id: id,
  code: `acct-${id}`,
  currency: 'USD',
  stored,
  expected,
});
const chain = (
  posting: number,
  recorded: bigint,
  expected: bigint,
): Report['chain_breaks'][number] => ({
  posting_id: posting,
  account_id: 'a',
  recorded,
  expected,
});

describe('compareReports', () => {
  it('finds nothing to say about two clean reports', () => {
    const c = compareReports(report(), report());
    expect(c.trend).toBe('same');
    expect(c.mismatches).toEqual({ appeared: [], resolved: [], changed: [], unchanged: [] });
    expect(c.currencies).toEqual([]);
  });

  it('says what appeared, what was resolved, what changed and what stayed', () => {
    const earlier = report({
      mismatches: [mismatch('a', 5n, 7n), mismatch('b', 1n, 2n), mismatch('c', 9n, 9n + 1n)],
    });
    const later = report({
      mismatches: [mismatch('b', 1n, 2n), mismatch('c', 9n, 20n), mismatch('d', 4n, 8n)],
    });
    const c = compareReports(earlier, later);
    expect(c.mismatches.appeared.map((m) => m.account_id)).toEqual(['d']);
    expect(c.mismatches.resolved.map((m) => m.account_id)).toEqual(['a']);
    expect(c.mismatches.unchanged.map((m) => m.account_id)).toEqual(['b']);
    expect(c.mismatches.changed.map((m) => [m.before.expected, m.after.expected])).toEqual([
      [10n, 20n],
    ]);
    expect(c.trend).toBe('mixed');
  });

  it('is better when problems went away, and worse when they came', () => {
    const bad = report({ ok: false, mismatches: [mismatch('a', 1n, 2n)] });
    expect(compareReports(bad, report()).trend).toBe('better');
    expect(compareReports(report(), bad).trend).toBe('worse');
  });

  it('compares the totals per currency, and a currency that stopped balancing is worse', () => {
    const earlier = report({
      currencies: [
        { currency: 'EUR', debits: 5n, credits: 5n, balanced: true },
        { currency: 'USD', debits: 10n, credits: 10n, balanced: true },
      ],
    });
    const later = report({
      currencies: [
        { currency: 'EUR', debits: 5n, credits: 5n, balanced: true },
        { currency: 'USD', debits: 20n, credits: 19n, balanced: false },
        { currency: 'JPY', debits: 1n, credits: 1n, balanced: true },
      ],
    });
    const c = compareReports(earlier, later);
    expect(c.currencies.map((x) => x.currency)).toEqual(['JPY', 'USD']); // EUR did not change
    expect(c.currencies[0]).toMatchObject({ before: undefined, after: { debits: 1n } });
    expect(c.currencies[1]).toMatchObject({
      before: { debits: 10n },
      after: { debits: 20n, balanced: false },
    });
    expect(c.trend).toBe('worse');
  });

  it('compares balance-chain breaks only when both reports are deep', () => {
    const deepA = report({
      deep: true,
      ok: false,
      chain_breaks: [chain(1, 5n, 6n), chain(2, 1n, 1n + 1n)],
    });
    const deepB = report({
      deep: true,
      ok: false,
      chain_breaks: [chain(2, 1n, 2n), chain(3, 7n, 8n)],
    });
    const c = compareReports(deepA, deepB);
    expect(c.chainBreaks?.appeared.map((x) => x.posting_id)).toEqual([3]);
    expect(c.chainBreaks?.resolved.map((x) => x.posting_id)).toEqual([1]);
    expect(c.chainBreaks?.unchanged.map((x) => x.posting_id)).toEqual([2]);

    expect(compareReports(report({ deep: false }), deepB).chainBreaks).toBeUndefined();
    expect(compareReports(deepA, report({ deep: false })).chainBreaks).toBeUndefined();
  });

  it('reports the number of accounts checked in each', () => {
    expect(
      compareReports(report({ accounts_checked: 2 }), report({ accounts_checked: 9 }))
        .accountsChecked,
    ).toEqual({ before: 2, after: 9 });
  });

  describe('properties', () => {
    const mm = fc.record({
      id: fc.constantFrom('a', 'b', 'c', 'd', 'e'),
      stored: fc.bigInt({ min: 0n, max: 5n }),
      expected: fc.bigInt({ min: 0n, max: 5n }),
    });
    const reports = fc
      .uniqueArray(mm, { selector: (m) => m.id, maxLength: 5 })
      .map((list) => report({ mismatches: list.map((m) => mismatch(m.id, m.stored, m.expected)) }));

    it('accounts for every mismatch of both reports exactly once', () => {
      fc.assert(
        fc.property(reports, reports, (a, b) => {
          const m = compareReports(a, b).mismatches;
          expect(m.appeared.length + m.changed.length + m.unchanged.length).toBe(
            b.mismatches.length,
          );
          expect(m.resolved.length + m.changed.length + m.unchanged.length).toBe(
            a.mismatches.length,
          );
        }),
      );
    });

    it('is symmetric: what appeared one way was resolved the other', () => {
      fc.assert(
        fc.property(reports, reports, (a, b) => {
          const forward = compareReports(a, b).mismatches;
          const backward = compareReports(b, a).mismatches;
          expect(forward.appeared.map((x) => x.account_id).sort()).toEqual(
            backward.resolved.map((x) => x.account_id).sort(),
          );
          expect(forward.changed).toHaveLength(backward.changed.length);
        }),
      );
    });

    it('finds nothing between a report and itself', () => {
      fc.assert(
        fc.property(reports, (a) => {
          const c = compareReports(a, a);
          expect(c.mismatches.appeared).toEqual([]);
          expect(c.mismatches.resolved).toEqual([]);
          expect(c.mismatches.changed).toEqual([]);
          expect(c.trend).toBe('same');
        }),
      );
    });
  });
});
