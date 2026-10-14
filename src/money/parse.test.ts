import { describe, expect, it } from 'vitest';

import { parseAmount, type MoneyErrorCode } from './parse';

function minor(text: string, scale: number): bigint {
  const result = parseAmount(text, scale);
  if (!result.ok) throw new Error(`expected ${text} to parse, got ${result.error.code}`);
  return result.value;
}

function reason(text: string, scale: number): MoneyErrorCode {
  const result = parseAmount(text, scale);
  if (result.ok) throw new Error(`expected ${text} to be rejected, got ${result.value.toString()}`);
  return result.error.code;
}

describe('parseAmount', () => {
  it('turns major units into exact minor units', () => {
    expect(minor('100', 2)).toBe(10000n);
    expect(minor('100.5', 2)).toBe(10050n);
    expect(minor('100.50', 2)).toBe(10050n);
    expect(minor('0.05', 2)).toBe(5n);
    expect(minor('0.5', 2)).toBe(50n);
    expect(minor('7', 0)).toBe(7n);
    expect(minor('0.000000000000000001', 18)).toBe(1n);
    expect(minor('1', 18)).toBe(10n ** 18n);
  });

  it('accepts leading zeros in the typed value and normalises them', () => {
    expect(minor('007.50', 2)).toBe(750n);
    expect(minor('0.50', 2)).toBe(50n);
  });

  it('is exact where floating point is not', () => {
    // 2^53 + 1 minor units and 0.1 + 0.2 style values must come back digit for digit.
    expect(minor('9007199254740993', 0)).toBe(9007199254740993n);
    expect(minor('0.30', 2)).toBe(30n);
    expect(minor('90071992547409.93', 2)).toBe(9007199254740993n);
  });

  it('accepts exactly the maximum and rejects one more', () => {
    expect(minor('1000000000000000000000000000000', 0)).toBe(10n ** 30n);
    expect(reason('1000000000000000000000000000001', 0)).toBe('too_large');
    expect(minor('10000000000000000000000000000.00', 2)).toBe(10n ** 30n);
    expect(reason('10000000000000000000000000000.01', 2)).toBe('too_large');
  });

  it.each<[string, MoneyErrorCode]>([
    ['', 'empty'],
    [' 5', 'padding'],
    ['5 ', 'padding'],
    ['5\n', 'padding'],
    ['+5', 'sign'],
    ['-5', 'sign'],
    ['1e3', 'exponent'],
    ['1E3', 'exponent'],
    ['1,5', 'separator'],
    ['1,000.00', 'separator'],
    ['1,000', 'separator'],
    ['.5', 'malformed'],
    ['5.', 'malformed'],
    ['1.2.3', 'malformed'],
    ['abc', 'malformed'],
    ['5 0', 'malformed'],
    ['0x10', 'malformed'],
    ['１２３', 'malformed'], // full-width digits
    ['٣', 'malformed'], // Arabic-Indic digit
    ['Infinity', 'malformed'],
    ['NaN', 'malformed'],
    ['0', 'zero'],
    ['0.00', 'zero'],
    ['000', 'zero'],
    ['1.234', 'too_many_decimals'],
    ['9'.repeat(200), 'too_large'],
  ])('rejects %j as %s', (text, code) => {
    expect(reason(text, 2)).toBe(code);
  });

  it('allows no decimals at all for a scale of 0', () => {
    expect(reason('1.0', 0)).toBe('too_many_decimals');
    expect(reason('1.5', 0)).toBe('too_many_decimals');
  });

  it('gives every rejection a message a person can act on', () => {
    for (const text of ['', ' 1', '-1', '1e1', '1,0', '.5', '0', '1.234']) {
      const result = parseAmount(text, 2);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message.length).toBeGreaterThan(10);
    }
  });

  it('refuses a scale outside 0..30 instead of guessing', () => {
    expect(() => parseAmount('1', -1)).toThrow(RangeError);
    expect(() => parseAmount('1', 31)).toThrow(RangeError);
    expect(() => parseAmount('1', 1.5)).toThrow(RangeError);
  });
});
