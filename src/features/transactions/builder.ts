import { parseAmount, resolveScale } from '../../money';
import type { Side } from '../accounts/rules';

/** What the builder needs to know about the account chosen for a posting. */
export interface AccountRef {
  id: string;
  code: string;
  currency: string;
}

export interface Row {
  /** Stable while the row exists, whatever its position (row 3 may become row 2). */
  id: number;
  account: AccountRef | undefined;
  direction: Side;
  /** What was typed, in major units ("100.50"); read with the currency's scale. */
  amountText: string;
}

export interface BuilderState {
  description: string;
  rows: Row[];
  nextRowId: number;
  /** The Idempotency-Key for this operation. */
  key: string;
}

export const MIN_ROWS = 2;
export const MAX_ROWS = 100;
export const MAX_DESCRIPTION = 500;

export function initialState(key: string): BuilderState {
  return {
    description: '',
    rows: [
      { id: 1, account: undefined, direction: 'DEBIT', amountText: '' },
      { id: 2, account: undefined, direction: 'CREDIT', amountText: '' },
    ],
    nextRowId: 3,
    key,
  };
}

export type Action =
  | { type: 'setDescription'; text: string }
  | { type: 'addRow' }
  | { type: 'removeRow'; id: number }
  | { type: 'setAccount'; id: number; account: AccountRef | undefined }
  | { type: 'setDirection'; id: number; direction: Side }
  | { type: 'setAmount'; id: number; text: string }
  | { type: 'simpleTransfer' }
  | { type: 'setKey'; key: string }
  | { type: 'reset'; key: string };

const mapRow = (state: BuilderState, id: number, change: (row: Row) => Row): BuilderState => ({
  ...state,
  rows: state.rows.map((row) => (row.id === id ? change(row) : row)),
});

/** All changes to a transaction being built, as a pure function so it can be tested alone. */
export function reducer(state: BuilderState, action: Action): BuilderState {
  switch (action.type) {
    case 'setDescription':
      return { ...state, description: action.text };

    case 'addRow':
      if (state.rows.length >= MAX_ROWS) return state;
      return {
        ...state,
        rows: [
          ...state.rows,
          { id: state.nextRowId, account: undefined, direction: 'DEBIT', amountText: '' },
        ],
        nextRowId: state.nextRowId + 1,
      };

    case 'removeRow':
      if (state.rows.length <= MIN_ROWS) return state;
      return { ...state, rows: state.rows.filter((row) => row.id !== action.id) };

    case 'setAccount':
      return mapRow(state, action.id, (row) => ({ ...row, account: action.account }));

    case 'setDirection':
      return mapRow(state, action.id, (row) => ({ ...row, direction: action.direction }));

    case 'setAmount':
      return mapRow(state, action.id, (row) => ({ ...row, amountText: action.text }));

    case 'simpleTransfer': {
      // Exactly one debit and one credit of the same amount, keeping what is already chosen:
      // the first debit and the first credit if there are such rows, else the first two rows.
      const debit = state.rows.find((r) => r.direction === 'DEBIT') ?? state.rows[0];
      const credit =
        state.rows.find((r) => r !== debit && r.direction === 'CREDIT') ??
        state.rows.find((r) => r !== debit);
      if (debit === undefined || credit === undefined) return state;
      const amountText =
        [debit, credit].map((r) => r.amountText).find((t) => t.trim() !== '') ?? '';
      return {
        ...state,
        rows: [
          { ...debit, direction: 'DEBIT', amountText },
          { ...credit, direction: 'CREDIT', amountText },
        ],
      };
    }

    case 'setKey':
      return { ...state, key: action.key };

    case 'reset':
      return initialState(action.key);
  }
}

/** The part of the display settings the builder depends on. */
export interface Scales {
  scales: Readonly<Record<string, number>>;
}

export type RowAmount =
  | { kind: 'unset' }
  | { kind: 'needs_account' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; value: bigint };

/** What a row's typed amount means, in minor units of the currency of its account. */
export function rowAmount(row: Row, settings: Scales): RowAmount {
  if (row.amountText.trim() === '') return { kind: 'unset' };
  if (row.account === undefined) return { kind: 'needs_account' };
  const parsed = parseAmount(row.amountText, resolveScale(row.account.currency, settings.scales));
  return parsed.ok
    ? { kind: 'ok', value: parsed.value }
    : { kind: 'error', message: parsed.error.message };
}

export interface CurrencyTotals {
  currency: string;
  debits: bigint;
  credits: bigint;
  /** Debits minus credits: zero when balanced. */
  difference: bigint;
  balanced: boolean;
}

/**
 * Totals per currency of the postings that are complete (an account and a valid amount).
 * All arithmetic is bigint.
 */
export function totalsByCurrency(state: BuilderState, settings: Scales): CurrencyTotals[] {
  const sums = new Map<string, { debits: bigint; credits: bigint }>();
  for (const row of state.rows) {
    const amount = rowAmount(row, settings);
    if (row.account === undefined || amount.kind !== 'ok') continue;
    const sum = sums.get(row.account.currency) ?? { debits: 0n, credits: 0n };
    if (row.direction === 'DEBIT') sum.debits += amount.value;
    else sum.credits += amount.value;
    sums.set(row.account.currency, sum);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, { debits, credits }]) => ({
      currency,
      debits,
      credits,
      difference: debits - credits,
      balanced: debits === credits,
    }));
}

/**
 * - `incomplete`: some posting has no account or no valid amount, so nothing can be said yet;
 * - `balanced`: in every currency, debits equal credits;
 * - `unbalanced`: they differ in some currency.
 */
export type Verdict = 'incomplete' | 'balanced' | 'unbalanced';

export function verdict(state: BuilderState, settings: Scales): Verdict {
  const complete = state.rows.every(
    (row) => row.account !== undefined && rowAmount(row, settings).kind === 'ok',
  );
  if (!complete) return 'incomplete';
  return totalsByCurrency(state, settings).every((t) => t.balanced) ? 'balanced' : 'unbalanced';
}
