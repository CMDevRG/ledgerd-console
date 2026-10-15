import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_TYPES,
  conventionalSide,
  EMPTY_FORM,
  filtersFromParams,
  matchesFilters,
  paramsFromFilters,
  serverErrors,
  validateAccountForm,
  validateCode,
  validateCurrency,
  validateFilters,
  type AccountFormValues,
} from './rules';

const valid: AccountFormValues = {
  code: 'user:42.wallet',
  currency: 'USD',
  type: 'LIABILITY',
  normalBalance: 'CREDIT',
  allowNegative: false,
};

describe('conventionalSide', () => {
  it('is debit for assets and expenses, credit for the rest', () => {
    expect(ACCOUNT_TYPES.map((t) => [t, conventionalSide(t)])).toEqual([
      ['ASSET', 'DEBIT'],
      ['LIABILITY', 'CREDIT'],
      ['EQUITY', 'CREDIT'],
      ['INCOME', 'CREDIT'],
      ['EXPENSE', 'DEBIT'],
    ]);
  });
});

describe('validateCode (ledgerd: ^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$)', () => {
  it.each(['a', 'A', '0', 'user:42.wallet', 'assets_cash', 'a-b', 'x'.repeat(64), '9lives'])(
    'accepts %j',
    (code) => {
      expect(validateCode(code)).toBeUndefined();
    },
  );

  it.each([
    '',
    ' ',
    '-start',
    '.start',
    '_start',
    ':start',
    'has space',
    'a/b',
    'a@b',
    'é',
    'x'.repeat(65),
    'a\n',
    'tab\t',
  ])('refuses %j', (code) => {
    expect(validateCode(code)).toBeDefined();
  });

  it('says "Enter a code" for nothing, and the rule for the rest', () => {
    expect(validateCode('')).toBe('Enter a code');
    expect(validateCode('-x')).toContain('1 to 64 letters');
  });

  it('agrees with the pattern for any text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (code) => {
        const expected = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(code);
        expect(validateCode(code) === undefined).toBe(expected);
      }),
    );
  });
});

describe('validateCurrency (ledgerd: ^[A-Z0-9]{2,10}$)', () => {
  it.each(['US', 'USD', 'USDT', 'ABCDEFGHIJ', 'A1', '12'])('accepts %j', (c) => {
    expect(validateCurrency(c)).toBeUndefined();
  });
  it.each(['', 'U', 'usd', 'Usd', 'ABCDEFGHIJK', 'US D', 'US-D', 'ÜSD'])('refuses %j', (c) => {
    expect(validateCurrency(c)).toBeDefined();
  });
});

describe('validateAccountForm', () => {
  it('turns a valid form into the request body', () => {
    expect(validateAccountForm(valid)).toEqual({
      ok: true,
      body: {
        code: 'user:42.wallet',
        currency: 'USD',
        type: 'LIABILITY',
        normal_balance: 'CREDIT',
        allow_negative: false,
      },
    });
  });

  it('keeps the allow-negative flag', () => {
    const result = validateAccountForm({ ...valid, allowNegative: true });
    expect(result.ok && result.body.allow_negative).toBe(true);
  });

  it('reports every problem at once, by the API field names', () => {
    const result = validateAccountForm(EMPTY_FORM);
    expect(result).toEqual({
      ok: false,
      errors: {
        code: 'Enter a code',
        currency: 'Enter a currency',
        type: 'Choose a type',
        normal_balance: 'Choose a side',
      },
    });
  });

  it('reports only what is wrong', () => {
    const result = validateAccountForm({ ...valid, currency: 'usd' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['currency']);
  });

  it('never produces a body for a form ledgerd would refuse (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 70 }), fc.string({ maxLength: 12 }), (code, currency) => {
        const result = validateAccountForm({ ...valid, code, currency });
        if (result.ok) {
          expect(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(result.body.code)).toBe(true);
          expect(/^[A-Z0-9]{2,10}$/.test(result.body.currency)).toBe(true);
        }
      }),
    );
  });
});

describe('serverErrors', () => {
  it('places errors on the fields they name', () => {
    expect(
      serverErrors({ currency: 'must be 2 to 10', type: 'unknown type' }, 'validation_error'),
    ).toEqual({
      errors: { currency: 'must be 2 to 10', type: 'unknown type' },
      unplaced: [],
    });
  });

  it('keeps errors it cannot place, so none is lost', () => {
    expect(
      serverErrors({ 'postings[0].amount': 'bad', code: 'taken' }, 'validation_error'),
    ).toEqual({
      errors: { code: 'taken' },
      unplaced: ['postings[0].amount: bad'],
    });
  });

  it('shows a duplicate code beside the code field', () => {
    expect(serverErrors({}, 'account_code_exists').errors.code).toBe(
      'An account with this code already exists',
    );
  });

  it('has nothing to say about other refusals', () => {
    expect(serverErrors({}, 'internal_error')).toEqual({ errors: {}, unplaced: [] });
  });
});

describe('filters', () => {
  it('reads them from the address, trimmed, and writes only what is set', () => {
    expect(filtersFromParams(new URLSearchParams('code=%20assets%20&currency=USD'))).toEqual({
      code: 'assets',
      currency: 'USD',
    });
    expect(filtersFromParams(new URLSearchParams(''))).toEqual({ code: '', currency: '' });
    expect(paramsFromFilters({ code: 'a', currency: '' }).toString()).toBe('code=a');
    expect(paramsFromFilters({ code: '', currency: '' }).toString()).toBe('');
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9._:-]{0,20}$/),
        fc.stringMatching(/^[A-Z0-9]{0,10}$/),
        (code, currency) => {
          const filters = { code, currency };
          expect(filtersFromParams(paramsFromFilters(filters))).toEqual(filters);
        },
      ),
    );
  });

  it('refuses a currency or prefix ledgerd would refuse, and says why', () => {
    expect(validateFilters({ code: '', currency: '' })).toEqual({});
    expect(validateFilters({ code: 'assets:', currency: 'USD' })).toEqual({});
    expect(validateFilters({ code: 'has space', currency: 'usd' })).toEqual({
      code: 'Use letters, digits, . _ : or - (up to 64)',
      currency: 'Use 2 to 10 capital letters or digits, such as USD',
    });
    expect(validateFilters({ code: 'x'.repeat(65), currency: '' }).code).toBeDefined();
  });

  it('matches an account the way the server filters: prefix and exact currency', () => {
    const account = { code: 'assets:cash', currency: 'USD' };
    expect(matchesFilters(account, { code: '', currency: '' })).toBe(true);
    expect(matchesFilters(account, { code: 'assets', currency: '' })).toBe(true);
    expect(matchesFilters(account, { code: 'cash', currency: '' })).toBe(false); // a prefix, not "contains"
    expect(matchesFilters(account, { code: '', currency: 'USD' })).toBe(true);
    expect(matchesFilters(account, { code: '', currency: 'EUR' })).toBe(false);
    expect(matchesFilters(account, { code: 'ASSETS', currency: '' })).toBe(false); // case matters
  });
});
