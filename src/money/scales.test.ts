import { describe, expect, it } from 'vitest';

import { defaultScale, resolveScale } from './scales';

describe('scales', () => {
  it('knows the common currencies', () => {
    expect(defaultScale('USD')).toBe(2);
    expect(defaultScale('JPY')).toBe(0);
    expect(defaultScale('USDT')).toBe(6);
    expect(defaultScale('ETH')).toBe(18);
  });

  it('falls back to 2 for an unknown asset', () => {
    expect(defaultScale('ZZZ')).toBe(2);
  });

  it('prefers a valid user override', () => {
    expect(resolveScale('USD', { USD: 4 })).toBe(4);
    expect(resolveScale('ZZZ', { ZZZ: 8 })).toBe(8);
  });

  it('ignores an invalid override rather than breaking every amount', () => {
    expect(resolveScale('USD', { USD: -1 })).toBe(2);
    expect(resolveScale('USD', { USD: 99 })).toBe(2);
    expect(resolveScale('USD', { USD: 2.5 })).toBe(2);
  });
});
