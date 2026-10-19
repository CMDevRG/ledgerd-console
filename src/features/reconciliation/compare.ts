import type { ReconciliationReport } from '../../api/schemas';

type Mismatch = ReconciliationReport['mismatches'][number];
type ChainBreak = ReconciliationReport['chain_breaks'][number];
type CurrencyTotals = ReconciliationReport['currencies'][number];

export interface Change<T> {
  before: T;
  after: T;
}

export interface CurrencyChange {
  currency: string;
  before: CurrencyTotals | undefined;
  after: CurrencyTotals | undefined;
}

export interface Comparison {
  accountsChecked: { before: number; after: number };
  mismatches: {
    /** In the later report only. */
    appeared: Mismatch[];
    /** In the earlier report only. */
    resolved: Mismatch[];
    /** In both, but with other amounts. */
    changed: Change<Mismatch>[];
    unchanged: Mismatch[];
  };
  /**
   * Chain breaks come only from a deep run. When one of the two was a standard run they cannot
   * be compared, and this is undefined.
   */
  chainBreaks:
    | {
        appeared: ChainBreak[];
        resolved: ChainBreak[];
        changed: Change<ChainBreak>[];
        unchanged: ChainBreak[];
      }
    | undefined;
  /** Per currency, in code order, only those whose totals or verdict differ. */
  currencies: CurrencyChange[];
  /** Whether the later report is in better, worse or the same state as the earlier. */
  trend: 'better' | 'worse' | 'same' | 'mixed';
}

/** Splits two lists, keyed, into what appeared, what went, what changed and what stayed. */
function diff<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  same: (a: T, b: T) => boolean,
) {
  const earlier = new Map(before.map((item) => [key(item), item]));
  const later = new Map(after.map((item) => [key(item), item]));
  const appeared: T[] = [];
  const resolved: T[] = [];
  const changed: Change<T>[] = [];
  const unchanged: T[] = [];
  for (const [k, item] of later) {
    const was = earlier.get(k);
    if (was === undefined) appeared.push(item);
    else if (same(was, item)) unchanged.push(item);
    else changed.push({ before: was, after: item });
  }
  for (const [k, item] of earlier) if (!later.has(k)) resolved.push(item);
  return { appeared, resolved, changed, unchanged };
}

const sameTotals = (a: CurrencyTotals, b: CurrencyTotals): boolean =>
  a.debits === b.debits && a.credits === b.credits && a.balanced === b.balanced;

/** What changed between an earlier report and a later one. */
export function compareReports(
  earlier: ReconciliationReport,
  later: ReconciliationReport,
): Comparison {
  const mismatches = diff(
    earlier.mismatches,
    later.mismatches,
    (m) => m.account_id,
    (a, b) => a.stored === b.stored && a.expected === b.expected,
  );

  const chainBreaks =
    earlier.deep && later.deep
      ? diff(
          earlier.chain_breaks,
          later.chain_breaks,
          (c) => String(c.posting_id),
          (a, b) => a.recorded === b.recorded && a.expected === b.expected,
        )
      : undefined;

  const before = new Map(earlier.currencies.map((c) => [c.currency, c]));
  const after = new Map(later.currencies.map((c) => [c.currency, c]));
  const currencies = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((currency): CurrencyChange[] => {
      const b = before.get(currency);
      const a = after.get(currency);
      return b !== undefined && a !== undefined && sameTotals(b, a)
        ? []
        : [{ currency, before: b, after: a }];
    });

  const worse =
    mismatches.appeared.length +
    (chainBreaks?.appeared.length ?? 0) +
    currencies.filter((c) => c.before?.balanced !== false && c.after?.balanced === false).length;
  const better =
    mismatches.resolved.length +
    (chainBreaks?.resolved.length ?? 0) +
    currencies.filter((c) => c.before?.balanced === false && c.after?.balanced !== false).length;
  const trend =
    worse > 0 && better > 0 ? 'mixed' : worse > 0 ? 'worse' : better > 0 ? 'better' : 'same';

  return {
    accountsChecked: { before: earlier.accounts_checked, after: later.accounts_checked },
    mismatches,
    chainBreaks,
    currencies,
    trend,
  };
}
