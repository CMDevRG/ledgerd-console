import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { initialState, reducer, type AccountRef, type Action, type BuilderState } from './builder';
import {
  buildRequest,
  clearErrorsFor,
  hasErrors,
  placeServerErrors,
  type BuildErrors,
} from './request';

const usd: AccountRef = {
  id: '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11',
  code: 'cash',
  currency: 'USD',
};
const eur: AccountRef = {
  id: '9a1d1c7e-5b52-4e5e-8f1c-2a7c8d9e0f11',
  code: 'bank',
  currency: 'EUR',
};
const none = { scales: {} };

const run = (state: BuilderState, ...actions: Action[]): BuilderState =>
  actions.reduce(reducer, state);
const deposit = (): BuilderState =>
  run(
    initialState('k'),
    { type: 'setAccount', id: 1, account: usd },
    { type: 'setAmount', id: 1, text: '100' },
    { type: 'setAccount', id: 2, account: eur },
    { type: 'setAmount', id: 2, text: '100.50' },
  );

describe('buildRequest', () => {
  it('turns the form into the body ledgerd takes: minor units as digit strings, currency from the account', () => {
    expect(buildRequest(deposit(), none)).toEqual({
      ok: true,
      body: {
        postings: [
          { account_id: usd.id, direction: 'DEBIT', amount: '10000', currency: 'USD' },
          { account_id: eur.id, direction: 'CREDIT', amount: '10050', currency: 'EUR' },
        ],
      },
    });
  });

  it('includes the description when there is one, and leaves it out when empty', () => {
    const withText = buildRequest(
      run(deposit(), { type: 'setDescription', text: 'Deposit' }),
      none,
    );
    expect(withText.ok && withText.body.description).toBe('Deposit');
    const without = buildRequest(deposit(), none);
    expect(without.ok && 'description' in without.body).toBe(false);
  });

  it('sends the postings in the order of the rows', () => {
    const s = run(
      deposit(),
      { type: 'addRow' },
      { type: 'setAccount', id: 3, account: usd },
      { type: 'setAmount', id: 3, text: '1' },
    );
    const result = buildRequest(s, none);
    expect(result.ok && result.body.postings.map((p) => p.amount)).toEqual([
      '10000',
      '10050',
      '100',
    ]);
  });

  it('sends an unbalanced transaction: that is for the server to refuse, so it can be seen', () => {
    const result = buildRequest(deposit(), none); // 100 USD debit, 100.50 EUR credit
    expect(result.ok).toBe(true);
  });

  it('reports every problem on every row at once', () => {
    const result = buildRequest(initialState('k'), none);
    expect(result).toEqual({
      ok: false,
      errors: {
        general: [],
        rows: {
          1: { account: 'Choose an account', amount: 'Enter an amount' },
          2: { account: 'Choose an account', amount: 'Enter an amount' },
        },
      },
    });
  });

  it("says why an amount is wrong, in the currency's scale", () => {
    const s = run(deposit(), { type: 'setAmount', id: 1, text: '1.234' });
    const result = buildRequest(s, none);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.rows[1]?.amount).toMatch(/decimal/i);
  });

  it('asks for the account first when an amount is typed without one', () => {
    const s = run(initialState('k'), { type: 'setAmount', id: 1, text: '5' });
    const result = buildRequest(s, none);
    if (result.ok) throw new Error('should fail');
    expect(result.errors.rows[1]).toEqual({
      account: 'Choose an account',
      amount: 'Choose an account first',
    });
  });

  it('refuses a description over 500 characters, counting characters and not bytes', () => {
    const ok = run(deposit(), { type: 'setDescription', text: 'é'.repeat(500) });
    expect(buildRequest(ok, none).ok).toBe(true);
    const emoji = run(deposit(), { type: 'setDescription', text: '😀'.repeat(500) }); // 2 UTF-16 units each
    expect(buildRequest(emoji, none).ok).toBe(true);
    const long = run(deposit(), { type: 'setDescription', text: 'x'.repeat(501) });
    const result = buildRequest(long, none);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.description).toBe('Use at most 500 characters');
  });

  it('never produces a body with an invalid amount or a missing account (property)', () => {
    const text = fc.oneof(
      fc.constant(''),
      fc.string({ maxLength: 12 }),
      fc.stringMatching(/^\d{1,6}(\.\d{1,3})?$/),
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(text, fc.boolean()), { minLength: 2, maxLength: 8 }),
        (rows) => {
          let s = initialState('k');
          rows.slice(2).forEach(() => (s = run(s, { type: 'addRow' })));
          rows.forEach(([amount, hasAccount], i) => {
            const id = s.rows[i]?.id ?? 0;
            s = run(
              s,
              { type: 'setAmount', id, text: amount },
              { type: 'setAccount', id, account: hasAccount ? usd : undefined },
            );
          });
          const result = buildRequest(s, none);
          if (result.ok) {
            for (const p of result.body.postings) {
              expect(p.amount).toMatch(/^[1-9]\d{0,30}$/); // the contract's Amount
              expect(p.account_id).toBe(usd.id);
            }
            expect(result.body.postings).toHaveLength(rows.length);
          }
        },
      ),
    );
  });
});

describe('placeServerErrors', () => {
  const state = run(deposit(), { type: 'addRow' }); // rows 1, 2, 3

  it('puts a posting error on the row it names, by position', () => {
    const { errors, unplaced } = placeServerErrors(
      { 'postings[1].amount': 'is required', 'postings[2].direction': 'must be DEBIT or CREDIT' },
      state,
    );
    expect(errors.rows).toEqual({
      2: { amount: 'is required' },
      3: { direction: 'must be DEBIT or CREDIT' },
    });
    expect(unplaced).toEqual([]);
  });

  it('follows the row, not its number, after a row was removed', () => {
    const afterRemoval = run(state, { type: 'removeRow', id: 1 }); // rows 2, 3 are now postings[0], [1]
    expect(placeServerErrors({ 'postings[0].amount': 'bad' }, afterRemoval).errors.rows).toEqual({
      2: { amount: 'bad' },
    });
  });

  it('shows account and currency problems on the account, since the currency comes from it', () => {
    const { errors } = placeServerErrors(
      { 'postings[0].account_id': 'is required', 'postings[1].currency': 'must be 2 to 10' },
      state,
    );
    expect(errors.rows).toEqual({
      1: { account: 'is required' },
      2: { account: 'must be 2 to 10' },
    });
  });

  it('places the description and the number of postings', () => {
    const { errors } = placeServerErrors(
      { description: 'too long', postings: 'must contain at least 2 postings' },
      state,
    );
    expect(errors.description).toBe('too long');
    expect(errors.general).toEqual(['must contain at least 2 postings']);
  });

  it('keeps what it cannot place, so no error is lost', () => {
    const { errors, unplaced } = placeServerErrors(
      {
        'postings[9].amount': 'row that is not there',
        'postings[0].weight': 'unknown',
        mystery: 'huh',
      },
      state,
    );
    expect(hasErrors(errors)).toBe(false);
    expect(unplaced.sort()).toEqual([
      'mystery: huh',
      'postings[0].weight: unknown',
      'postings[9].amount: row that is not there',
    ]);
  });

  it('has nothing for no errors', () => {
    expect(hasErrors(placeServerErrors({}, state).errors)).toBe(false);
  });
});

describe('clearErrorsFor', () => {
  const errors: BuildErrors = {
    description: 'too long',
    general: ['must contain at least 2 postings'],
    rows: {
      1: { account: 'Choose an account', amount: 'Enter an amount' },
      2: { direction: 'bad' },
    },
  };

  it('drops the description error when the description changes, and no other', () => {
    const after = clearErrorsFor(errors, { type: 'setDescription', text: 'x' });
    expect(after.description).toBeUndefined();
    expect(after.rows).toEqual(errors.rows);
    expect(after.general).toEqual(errors.general);
  });

  it("drops the amount error when the amount changes, keeping the row's other errors", () => {
    expect(clearErrorsFor(errors, { type: 'setAmount', id: 1, text: '5' }).rows).toEqual({
      1: { account: 'Choose an account' },
      2: { direction: 'bad' },
    });
  });

  it('drops the account and the amount error when the account changes (the currency decides how an amount reads)', () => {
    expect(clearErrorsFor(errors, { type: 'setAccount', id: 1, account: undefined }).rows).toEqual({
      2: { direction: 'bad' },
    });
  });

  it('drops the direction error when the direction changes', () => {
    expect(
      clearErrorsFor(errors, { type: 'setDirection', id: 2, direction: 'CREDIT' }).rows,
    ).toEqual({
      1: errors.rows[1],
    });
  });

  it('forgets a removed row, and the count error when rows are added or removed', () => {
    const removed = clearErrorsFor(errors, { type: 'removeRow', id: 1 });
    expect(removed.rows).toEqual({ 2: { direction: 'bad' } });
    expect(removed.general).toEqual([]);
    expect(clearErrorsFor(errors, { type: 'addRow' }).general).toEqual([]);
  });

  it('forgets every row error after a simple transfer or a reset', () => {
    expect(clearErrorsFor(errors, { type: 'simpleTransfer' }).rows).toEqual({});
    expect(clearErrorsFor(errors, { type: 'reset', key: 'k' })).toEqual({ rows: {}, general: [] });
  });

  it('leaves errors alone for a change that cannot fix them, and for an unrelated row', () => {
    expect(clearErrorsFor(errors, { type: 'setKey', key: 'k' })).toBe(errors);
    expect(clearErrorsFor(errors, { type: 'setAmount', id: 99, text: '1' })).toBe(errors);
  });
});
