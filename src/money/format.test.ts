import { describe, expect, it } from 'vitest';

import { formatAmount, formatMinor } from './format';

describe('formatAmount', () => {
  it.each<[bigint, number, string]>([
    [10000n, 2, '100.00'],
    [5n, 2, '0.05'],
    [0n, 2, '0.00'],
    [123456789n, 0, '123456789'],
    [1n, 18, '0.000000000000000001'],
    [10n ** 18n, 18, '1.000000000000000000'],
    [10n ** 30n, 2, '10000000000000000000000000000.00'],
    [-250n, 2, '-2.50'],
    [-5n, 2, '-0.05'],
  ])('formats %s at scale %i as %s', (value, scale, expected) => {
    expect(formatAmount(value, scale)).toBe(expected);
  });

  it('reads the decimal strings ledgerd sends', () => {
    expect(formatAmount('9223372036854775809', 0)).toBe('9223372036854775809');
    expect(formatAmount('-12345', 2)).toBe('-123.45');
  });

  it('groups thousands only when asked', () => {
    expect(formatAmount(1234567890n, 2)).toBe('12345678.90');
    expect(formatAmount(1234567890n, 2, { grouping: true })).toBe('12,345,678.90');
    expect(formatAmount(999n, 0, { grouping: true })).toBe('999');
    expect(formatAmount(1000n, 0, { grouping: true })).toBe('1,000');
    expect(formatAmount(-1234567n, 0, { grouping: true })).toBe('-1,234,567');
  });

  it('refuses anything that is not an integer amount, instead of printing a wrong number', () => {
    for (const bad of ['1.5', '1e3', ' 1', '', 'abc', '1'.repeat(39)]) {
      expect(() => formatAmount(bad, 2)).toThrow(RangeError);
    }
  });

  it('refuses a scale outside 0..30', () => {
    expect(() => formatAmount(1n, -1)).toThrow(RangeError);
    expect(() => formatAmount(1n, 31)).toThrow(RangeError);
  });
});

describe('formatMinor', () => {
  it('shows the raw minor units', () => {
    expect(formatMinor(10050n)).toBe('10050');
    expect(formatMinor('-42')).toBe('-42');
    expect(formatMinor(1234567n, { grouping: true })).toBe('1,234,567');
    expect(formatMinor(10n ** 30n)).toBe('1000000000000000000000000000000');
  });
});
