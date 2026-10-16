import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatAmount } from '../../money';
import {
  initialState,
  MAX_ROWS,
  MIN_ROWS,
  reducer,
  rowAmount,
  totalsByCurrency,
  verdict,
  type AccountRef,
  type Action,
  type BuilderState,
  type Row,
} from './builder';

const usd: AccountRef = { id: 'a1', code: 'cash', currency: 'USD' };
const eur: AccountRef = { id: 'a2', code: 'bank', currency: 'EUR' };
const jpy: AccountRef = { id: 'a3', code: 'yen', currency: 'JPY' };
const none = { scales: {} };

const run = (state: BuilderState, ...actions: Action[]): BuilderState =>
  actions.reduce(reducer, state);
const start = () => initialState('key-1');

describe('the reducer', () => {
  it('starts with a debit and a credit, empty', () => {
    const s = start();
    expect(s.rows.map((r) => [r.direction, r.account, r.amountText])).toEqual([
      ['DEBIT', undefined, ''],
      ['CREDIT', undefined, ''],
    ]);
    expect(s.key).toBe('key-1');
    expect(s.description).toBe('');
  });

  it('changes one row without touching the others', () => {
    const s = run(
      start(),
      { type: 'setAmount', id: 1, text: '10' },
      { type: 'setAccount', id: 2, account: usd },
    );
    expect(s.rows[0]?.amountText).toBe('10');
    expect(s.rows[1]?.account).toEqual(usd);
    expect(s.rows[0]?.account).toBeUndefined();
    expect(s.rows[1]?.amountText).toBe('');
  });

  it('adds rows with fresh ids, and ids are never reused after a removal', () => {
    let s = run(start(), { type: 'addRow' }, { type: 'addRow' });
    expect(s.rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    s = run(s, { type: 'removeRow', id: 3 }, { type: 'addRow' });
    expect(s.rows.map((r) => r.id)).toEqual([1, 2, 4, 5]);
  });

  it('keeps between 2 and 100 postings', () => {
    expect(run(start(), { type: 'removeRow', id: 1 }).rows).toHaveLength(MIN_ROWS);
    let s = start();
    for (let i = 0; i < 150; i += 1) s = run(s, { type: 'addRow' });
    expect(s.rows).toHaveLength(MAX_ROWS);
    for (let i = 0; i < 150; i += 1) s = run(s, { type: 'removeRow', id: s.rows[0]?.id ?? 0 });
    expect(s.rows).toHaveLength(MIN_ROWS);
  });

  it('ignores a change to a row that does not exist', () => {
    const s = start();
    expect(run(s, { type: 'setAmount', id: 99, text: '5' })).toEqual(s);
    expect(run(s, { type: 'removeRow', id: 99 }).rows).toHaveLength(2);
  });

  it('simple transfer leaves exactly one debit and one credit of the same amount, keeping the accounts', () => {
    let s = run(
      start(),
      { type: 'addRow' },
      { type: 'addRow' },
      { type: 'setAccount', id: 1, account: usd },
      { type: 'setAccount', id: 2, account: eur },
      { type: 'setAmount', id: 2, text: '12.50' },
      { type: 'setAmount', id: 3, text: '99' },
    );
    s = run(s, { type: 'simpleTransfer' });
    expect(s.rows).toHaveLength(2);
    expect(s.rows.map((r) => r.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(s.rows.map((r) => r.amountText)).toEqual(['12.50', '12.50']);
    expect(s.rows.map((r) => r.account)).toEqual([usd, eur]);
  });

  it('simple transfer takes the first debit and the first credit, wherever they are', () => {
    let s = run(
      start(),
      { type: 'setDirection', id: 1, direction: 'CREDIT' },
      { type: 'setDirection', id: 2, direction: 'DEBIT' },
      { type: 'setAccount', id: 1, account: usd },
      { type: 'setAccount', id: 2, account: eur },
    );
    s = run(s, { type: 'simpleTransfer' });
    expect(s.rows.map((r) => r.account)).toEqual([eur, usd]);
  });

  it('simple transfer works on a form with two debits', () => {
    const s = run(
      start(),
      { type: 'setDirection', id: 2, direction: 'DEBIT' },
      { type: 'simpleTransfer' },
    );
    expect(s.rows.map((r) => r.direction)).toEqual(['DEBIT', 'CREDIT']);
  });

  it('resets to a clean form with a new key, and the key can be replaced', () => {
    const s = run(
      start(),
      { type: 'setDescription', text: 'x' },
      { type: 'addRow' },
      { type: 'reset', key: 'key-2' },
    );
    expect(s).toEqual(initialState('key-2'));
    expect(run(start(), { type: 'setKey', key: 'mine' }).key).toBe('mine');
  });

  it('never leaves a state with fewer than 2 or more than 100 rows, whatever is done (property)', () => {
    const action = fc.oneof(
      fc.constant<Action>({ type: 'addRow' }),
      fc.integer({ min: 0, max: 40 }).map<Action>((id) => ({ type: 'removeRow', id })),
      fc.constant<Action>({ type: 'simpleTransfer' }),
      fc.integer({ min: 0, max: 40 }).map<Action>((id) => ({ type: 'setAmount', id, text: '1' })),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 300 }), (actions) => {
        const s = run(start(), ...actions);
        expect(s.rows.length).toBeGreaterThanOrEqual(MIN_ROWS);
        expect(s.rows.length).toBeLessThanOrEqual(MAX_ROWS);
        expect(new Set(s.rows.map((r) => r.id)).size).toBe(s.rows.length); // ids stay unique
      }),
    );
  });
});

describe('rowAmount', () => {
  const row = (account: AccountRef | undefined, amountText: string): Row => ({
    id: 1,
    account,
    direction: 'DEBIT',
    amountText,
  });

  it("reads the amount with the scale of the account's currency", () => {
    expect(rowAmount(row(usd, '12.34'), none)).toEqual({ kind: 'ok', value: 1234n });
    expect(rowAmount(row(jpy, '1234'), none)).toEqual({ kind: 'ok', value: 1234n });
    expect(rowAmount(row(usd, '1'), { scales: { USD: 4 } })).toEqual({ kind: 'ok', value: 10000n });
  });

  it('says what is wrong, using the scale', () => {
    expect(rowAmount(row(jpy, '12.5'), none).kind).toBe('error');
    expect(rowAmount(row(usd, '0'), none).kind).toBe('error');
    expect(rowAmount(row(usd, '-5'), none).kind).toBe('error');
  });

  it('cannot read an amount before an account fixes the currency, and says so', () => {
    expect(rowAmount(row(undefined, '12.34'), none)).toEqual({ kind: 'needs_account' });
    expect(rowAmount(row(undefined, ''), none)).toEqual({ kind: 'unset' });
    expect(rowAmount(row(usd, '   '), none)).toEqual({ kind: 'unset' });
  });
});

describe('totals and verdict', () => {
  const filled = (rows: [AccountRef, 'DEBIT' | 'CREDIT', string][]): BuilderState => {
    let s = start();
    rows.slice(2).forEach(() => (s = run(s, { type: 'addRow' })));
    rows.forEach(([account, direction, text], i) => {
      const id = s.rows[i]?.id ?? 0;
      s = run(
        s,
        { type: 'setAccount', id, account },
        { type: 'setDirection', id, direction },
        { type: 'setAmount', id, text },
      );
    });
    return s;
  };

  it('a simple deposit balances', () => {
    const s = filled([
      [usd, 'DEBIT', '100'],
      [usd, 'CREDIT', '100.00'],
    ]);
    expect(totalsByCurrency(s, none)).toEqual([
      { currency: 'USD', debits: 10000n, credits: 10000n, difference: 0n, balanced: true },
    ]);
    expect(verdict(s, none)).toBe('balanced');
  });

  it('shows the difference, with its sign', () => {
    const s = filled([
      [usd, 'DEBIT', '100'],
      [usd, 'CREDIT', '99.99'],
    ]);
    expect(totalsByCurrency(s, none)[0]).toMatchObject({
      debits: 10000n,
      credits: 9999n,
      difference: 1n,
      balanced: false,
    });
    expect(verdict(s, none)).toBe('unbalanced');
    const t = filled([
      [usd, 'DEBIT', '1'],
      [usd, 'CREDIT', '3'],
    ]);
    expect(totalsByCurrency(t, none)[0]?.difference).toBe(-200n);
  });

  it('balances each currency on its own: 100 USD against 100 EUR is not balanced', () => {
    const s = filled([
      [usd, 'DEBIT', '100'],
      [eur, 'CREDIT', '100'],
    ]);
    expect(totalsByCurrency(s, none).map((t) => [t.currency, t.balanced])).toEqual([
      ['EUR', false],
      ['USD', false],
    ]);
    expect(verdict(s, none)).toBe('unbalanced');
  });

  it('accepts a transaction that balances in two currencies at once', () => {
    const s = filled([
      [usd, 'DEBIT', '10'],
      [usd, 'CREDIT', '10'],
      [eur, 'DEBIT', '5'],
      [eur, 'CREDIT', '5'],
    ]);
    expect(verdict(s, none)).toBe('balanced');
  });

  it('is incomplete, not balanced, while a posting lacks an account or a valid amount', () => {
    expect(verdict(start(), none)).toBe('incomplete');
    expect(
      verdict(
        filled([
          [usd, 'DEBIT', '10'],
          [usd, 'CREDIT', 'abc'],
        ]),
        none,
      ),
    ).toBe('incomplete');
    const noAccount = run(
      filled([
        [usd, 'DEBIT', '10'],
        [usd, 'CREDIT', '10'],
      ]),
      { type: 'setAccount', id: 2, account: undefined },
    );
    expect(verdict(noAccount, none)).toBe('incomplete');
  });

  it('still totals what is complete while something else is incomplete', () => {
    const s = filled([
      [usd, 'DEBIT', '10'],
      [usd, 'CREDIT', 'abc'],
      [usd, 'CREDIT', '4'],
    ]);
    expect(totalsByCurrency(s, none)[0]).toMatchObject({ debits: 1000n, credits: 400n });
  });

  it('is exact at the largest amount: 10^30 minor units', () => {
    const big = '10000000000000000000000000000.00'; // 10^28 USD = 10^30 minor units
    const s = filled([
      [usd, 'DEBIT', big],
      [usd, 'CREDIT', big],
    ]);
    expect(totalsByCurrency(s, none)[0]?.debits).toBe(10n ** 30n);
    expect(verdict(s, none)).toBe('balanced');
  });

  it('uses the scale from the settings', () => {
    const s = filled([
      [usd, 'DEBIT', '1'],
      [usd, 'CREDIT', '1'],
    ]);
    expect(totalsByCurrency(s, { scales: { USD: 6 } })[0]?.debits).toBe(1_000_000n);
  });

  it('agrees with an independent computation for any postings (property)', () => {
    const currencies = [usd, eur, jpy];
    const scaleOf = { USD: 2, EUR: 2, JPY: 0 } as const;
    const row = fc.record({
      account: fc.constantFrom(...currencies),
      direction: fc.constantFrom<'DEBIT' | 'CREDIT'>('DEBIT', 'CREDIT'),
      minor: fc.bigInt({ min: 1n, max: 10n ** 30n }),
    });
    fc.assert(
      fc.property(fc.array(row, { minLength: 2, maxLength: 30 }), (rows) => {
        const state = filled(
          rows.map(
            (r) =>
              [
                r.account,
                r.direction,
                formatAmount(r.minor, scaleOf[r.account.currency as keyof typeof scaleOf]),
              ] as [AccountRef, 'DEBIT' | 'CREDIT', string],
          ),
        );
        // Independent: plain sums per currency from the minor amounts we started with.
        const expected = new Map<string, bigint>();
        for (const r of rows) {
          expected.set(
            r.account.currency,
            (expected.get(r.account.currency) ?? 0n) +
              (r.direction === 'DEBIT' ? r.minor : -r.minor),
          );
        }
        const totals = totalsByCurrency(state, none);
        expect(totals.map((t) => t.currency)).toEqual([...expected.keys()].sort());
        for (const t of totals) {
          expect(t.difference).toBe(expected.get(t.currency));
          expect(t.balanced).toBe(expected.get(t.currency) === 0n);
          expect(t.debits - t.credits).toBe(t.difference);
        }
        expect(verdict(state, none)).toBe(
          [...expected.values()].every((d) => d === 0n) ? 'balanced' : 'unbalanced',
        );
      }),
    );
  });
});
