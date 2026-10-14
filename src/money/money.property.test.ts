import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_AMOUNT, toBigInt } from './amount';
import { formatAmount } from './format';
import { parseAmount } from './parse';

const scale = fc.integer({ min: 0, max: 18 });
// Weighted towards the edges that break naive code: around 2^53, 2^63, 10^18 and 10^30.
const amount = fc.oneof(
  fc.bigInt({ min: 1n, max: MAX_AMOUNT }),
  fc.constantFrom(
    1n,
    2n ** 53n - 1n,
    2n ** 53n,
    2n ** 53n + 1n,
    2n ** 63n - 1n,
    2n ** 63n,
    2n ** 64n,
    10n ** 18n,
    MAX_AMOUNT - 1n,
    MAX_AMOUNT,
  ),
);

describe('money properties', () => {
  it('parse(format(x)) returns x for every valid amount and scale', () => {
    fc.assert(
      fc.property(amount, scale, (x, s) => {
        const result = parseAmount(formatAmount(x, s), s);
        expect(result).toEqual({ ok: true, value: x });
      }),
    );
  });

  it('grouping changes only the display: removing the commas parses back to the same amount', () => {
    fc.assert(
      fc.property(amount, scale, (x, s) => {
        const grouped = formatAmount(x, s, { grouping: true });
        expect(parseAmount(grouped.replaceAll(',', ''), s)).toEqual({ ok: true, value: x });
      }),
    );
  });

  it('formatting a negative is the negation of formatting the positive', () => {
    fc.assert(
      fc.property(amount, scale, (x, s) => {
        expect(formatAmount(-x, s)).toBe(`-${formatAmount(x, s)}`);
      }),
    );
  });

  it('format always shows exactly `scale` decimals', () => {
    fc.assert(
      fc.property(amount, scale, (x, s) => {
        const text = formatAmount(x, s);
        const decimals = text.includes('.') ? (text.split('.')[1] ?? '').length : 0;
        expect(decimals).toBe(s);
      }),
    );
  });

  it('the wire form (a digit string) survives a trip through bigint', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 38n) + 1n, max: 10n ** 38n - 1n }), (x) => {
        expect(toBigInt(x.toString())).toBe(x);
      }),
    );
  });

  // The other direction, against an oracle written differently from the implementation:
  // whatever text parse accepts must be plain digits with a short enough fraction, in range,
  // and formatting the result must reproduce the typed digits (ignoring leading zeros).
  it('accepts only plain decimal text, and reads it back digit for digit', () => {
    const noise = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.stringMatching(/^[0-9.,+\-eE ]{0,40}$/),
      fc
        .tuple(
          fc.stringMatching(/^[0-9]{1,36}$/),
          fc.option(fc.stringMatching(/^[0-9]{1,20}$/), { nil: undefined }),
        )
        .map(([whole, fraction]) => (fraction === undefined ? whole : `${whole}.${fraction}`)),
    );

    fc.assert(
      fc.property(noise, scale, (text, s) => {
        const result = parseAmount(text, s);
        if (!result.ok) return;

        expect(text).toMatch(/^[0-9]+(\.[0-9]+)?$/);
        const [whole = '', fraction = ''] = text.split('.');
        expect(fraction.length).toBeLessThanOrEqual(s);
        expect(result.value).toBeGreaterThan(0n);
        expect(result.value).toBeLessThanOrEqual(MAX_AMOUNT);

        const canonicalWhole = whole.replace(/^0+(?=\d)/, '');
        const canonical = s === 0 ? canonicalWhole : `${canonicalWhole}.${fraction.padEnd(s, '0')}`;
        expect(formatAmount(result.value, s)).toBe(canonical);
      }),
      { numRuns: 2000 },
    );
  });

  it('never accepts a signed, padded, grouped or exponent form, whatever surrounds the digits', () => {
    const digits = fc.stringMatching(/^[1-9][0-9]{0,10}$/);
    fc.assert(
      fc.property(digits, scale, fc.constantFrom('-', '+', ' ', '\t', ','), (d, s, junk) => {
        expect(parseAmount(junk + d, s).ok).toBe(false);
        expect(parseAmount(d + junk, s).ok).toBe(false);
      }),
    );
    fc.assert(
      fc.property(digits, scale, fc.constantFrom('e', 'E'), (d, s, e) => {
        expect(parseAmount(`${d}${e}3`, s).ok).toBe(false);
      }),
    );
  });
});
