import type { CreateTransactionBody } from '../../api/endpoints';
import { validateKey } from './key';
import {
  MAX_DESCRIPTION,
  MAX_ROWS,
  MIN_ROWS,
  rowAmount,
  type Action,
  type BuilderState,
  type Scales,
} from './builder';

/** What is wrong with one posting row, by field. */
export interface RowErrors {
  account?: string;
  direction?: string;
  amount?: string;
}

export interface BuildErrors {
  description?: string;
  /** The Idempotency-Key is not one ledgerd accepts. */
  key?: string;
  /** By row id. */
  rows: Record<number, RowErrors>;
  /** About the transaction as a whole (the number of postings). */
  general: string[];
}

export type BuildResult =
  { ok: true; body: CreateTransactionBody } | { ok: false; errors: BuildErrors };

/** The number of characters, counting what a person sees as one (ledgerd counts runes too). */
const characters = (text: string): number => Array.from(text).length;

/**
 * Turns the form into the request, or says what is wrong with it: the same structural rules as
 * ledgerd (2 to 100 postings, an account and a valid amount in each, a short description).
 * That the transaction balances is deliberately not checked here: a person may send an
 * unbalanced one to see the refusal.
 */
export function buildRequest(state: BuilderState, settings: Scales): BuildResult {
  const errors: BuildErrors = { rows: {}, general: [] };

  if (characters(state.description) > MAX_DESCRIPTION) {
    errors.description = `Use at most ${String(MAX_DESCRIPTION)} characters`;
  }
  const keyProblem = validateKey(state.key);
  if (keyProblem !== undefined) errors.key = keyProblem;
  if (state.rows.length < MIN_ROWS)
    errors.general.push(`Add at least ${String(MIN_ROWS)} postings`);
  if (state.rows.length > MAX_ROWS) errors.general.push(`Use at most ${String(MAX_ROWS)} postings`);

  const postings: CreateTransactionBody['postings'] = [];
  for (const row of state.rows) {
    const problems: RowErrors = {};
    const amount = rowAmount(row, settings);
    if (row.account === undefined) problems.account = 'Choose an account';
    if (amount.kind === 'unset') problems.amount = 'Enter an amount';
    else if (amount.kind === 'error') problems.amount = amount.message;
    else if (amount.kind === 'needs_account') problems.amount ??= 'Choose an account first';

    if (Object.keys(problems).length > 0) errors.rows[row.id] = problems;
    else if (row.account !== undefined && amount.kind === 'ok') {
      postings.push({
        account_id: row.account.id,
        direction: row.direction,
        amount: amount.value.toString(),
        currency: row.account.currency,
      });
    }
  }

  const failed =
    errors.description !== undefined ||
    errors.key !== undefined ||
    errors.general.length > 0 ||
    Object.keys(errors.rows).length > 0;
  if (failed) return { ok: false, errors };

  return {
    ok: true,
    body: {
      ...(state.description !== '' ? { description: state.description } : {}),
      postings,
    },
  };
}

export interface PlacedErrors {
  errors: BuildErrors;
  /** Errors that name nothing in the form, kept so none is lost. */
  unplaced: string[];
}

/**
 * Puts the server's field errors (`postings[2].amount`) on the rows they refer to. The
 * server counts postings from zero in the order sent, which is the order of the rows.
 */
export function placeServerErrors(
  fieldErrors: Readonly<Record<string, string>>,
  state: BuilderState,
): PlacedErrors {
  const errors: BuildErrors = { rows: {}, general: [] };
  const unplaced: string[] = [];

  for (const [field, message] of Object.entries(fieldErrors)) {
    const posting = /^postings\[(\d+)\]\.(\w+)$/.exec(field);
    if (posting !== null) {
      const row = state.rows[Number.parseInt(posting[1] ?? '', 10)];
      const name = posting[2];
      if (row !== undefined) {
        // The currency comes from the account, so a problem with it is a problem with the account.
        const slot =
          name === 'amount'
            ? 'amount'
            : name === 'direction'
              ? 'direction'
              : name === 'account_id' || name === 'currency'
                ? 'account'
                : undefined;
        if (slot === undefined) unplaced.push(`${field}: ${message}`);
        else errors.rows[row.id] = { ...errors.rows[row.id], [slot]: message };
        continue;
      }
    }
    if (field === 'description') errors.description = message;
    else if (field === 'postings') errors.general.push(message);
    else unplaced.push(`${field}: ${message}`);
  }
  return { errors, unplaced };
}

export const hasErrors = (errors: BuildErrors): boolean =>
  errors.description !== undefined ||
  errors.key !== undefined ||
  errors.general.length > 0 ||
  Object.keys(errors.rows).length > 0;

/** The errors without one of the form-wide messages. */
function omit(errors: BuildErrors, name: 'description' | 'key'): BuildErrors {
  return {
    ...(name === 'description' || errors.description === undefined
      ? {}
      : { description: errors.description }),
    ...(name === 'key' || errors.key === undefined ? {} : { key: errors.key }),
    rows: errors.rows,
    general: errors.general,
  };
}

/** The errors without the field `field` of row `id`; a row with no errors left is dropped. */
function withoutRowFields(
  errors: BuildErrors,
  id: number,
  ...fields: (keyof RowErrors)[]
): BuildErrors {
  const current = errors.rows[id];
  if (current === undefined) return errors;
  const kept = Object.entries(current).filter(
    ([name]) => !fields.includes(name as keyof RowErrors),
  );
  const rows = Object.fromEntries(
    Object.entries(errors.rows).filter(([key]) => Number(key) !== id),
  );
  return {
    ...errors,
    rows: kept.length === 0 ? rows : { ...rows, [id]: Object.fromEntries(kept) },
  };
}

/**
 * Drops the errors that an edit makes stale. What was wrong with a value says nothing about
 * the next one, so the error goes when the value changes; errors about other fields stay.
 * Changing the account also clears the amount's error, because how an amount is read depends
 * on the currency of the account.
 */
export function clearErrorsFor(errors: BuildErrors, action: Action): BuildErrors {
  switch (action.type) {
    case 'setDescription':
      return omit(errors, 'description');
    case 'setKey':
      return omit(errors, 'key');
    case 'setAccount':
      return withoutRowFields(errors, action.id, 'account', 'amount');
    case 'setAmount':
      return withoutRowFields(errors, action.id, 'amount');
    case 'setDirection':
      return withoutRowFields(errors, action.id, 'direction');
    case 'addRow':
      return { ...errors, general: [] };
    case 'removeRow': {
      const rows = Object.fromEntries(
        Object.entries(errors.rows).filter(([key]) => Number(key) !== action.id),
      );
      return { ...errors, rows, general: [] };
    }
    case 'simpleTransfer':
      return { ...errors, rows: {}, general: [] };
    case 'reset':
      return { rows: {}, general: [] };
  }
}
