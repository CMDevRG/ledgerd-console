import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AS_OF_RULE, parseAsOf } from './asOf';

const iso = (text: string): string | undefined => {
  const result = parseAsOf(text);
  return result.ok ? result.iso : undefined;
};

describe('parseAsOf', () => {
  it.each([
    ['2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'],
    ['2026-10-01 10:00', '2026-10-01T10:00:00Z'],
    ['2026-10-01 10:00:30', '2026-10-01T10:00:30Z'],
    ['2026-10-01T10:00', '2026-10-01T10:00:00Z'],
    ['  2026-10-01 10:00  ', '2026-10-01T10:00:00Z'],
    ['2026-10-01T10:00:00.5Z', '2026-10-01T10:00:00.5Z'],
    ['2026-10-01T10:00:00.123456789Z', '2026-10-01T10:00:00.123456789Z'],
    ['2026-10-01T12:00:00+02:00', '2026-10-01T10:00:00Z'],
    ['2026-10-01T05:30:00-04:30', '2026-10-01T10:00:00Z'],
    ['2026-10-01 00:30+01:00', '2026-09-30T23:30:00Z'], // the date moves back across midnight
    ['2026-12-31T23:30:00-01:00', '2027-01-01T00:30:00Z'], // and forward across the year
    ['2028-02-29 12:00', '2028-02-29T12:00:00Z'], // a leap day
  ])('%s -> %s', (input, expected) => {
    expect(iso(input)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    'yesterday',
    '2026-10-01',
    '10:00',
    '2026-10-01T10',
    '2026-13-01 10:00',
    '2026-00-10 10:00',
    '2026-02-30 10:00', // there is no 30 February
    '2026-02-29 10:00', // 2026 is not a leap year
    '2026-04-31 10:00',
    '2026-10-01 24:00',
    '2026-10-01 10:60',
    '2026-10-01 10:00:60',
    '2026-10-01 10:00:00.',
    '2026-10-01 10:00:00.1234567890', // ten fraction digits
    '2026-10-01T10:00:00z',
    '2026-10-01T10:00:00+0200',
    '2026-10-01T10:00:00+25:00',
    '2026-10-01T10:00:00+02:60',
    '0050-10-01 10:00', // Date.UTC would read year 50 as 1950
    '26-10-01 10:00',
    '2026/10/01 10:00',
    '1 Oct 2026',
    '2026-10-01 10:00 UTC',
    '2026-10-01\n10:00',
  ])('refuses %j, with the rule in words', (input) => {
    const result = parseAsOf(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(AS_OF_RULE);
  });

  it('agrees with the platform on the instant, for any moment and offset (oracle)', () => {
    const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('1990-01-01T00:00:00Z'),
          max: new Date('2100-01-01T00:00:00Z'),
          noInvalidDate: true,
        }),
        fc.integer({ min: -14 * 60, max: 14 * 60 }),
        (date, offsetMinutes) => {
          // Write the instant as a person in that offset would, then parse it back.
          const local = new Date(date.getTime() + offsetMinutes * 60_000);
          const sign = offsetMinutes < 0 ? '-' : '+';
          const abs = Math.abs(offsetMinutes);
          const text = `${local.toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
          const result = parseAsOf(text);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(Date.parse(result.iso)).toBe(Math.floor(date.getTime() / 1000) * 1000);
            expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
          }
        },
      ),
    );
  });

  it('is idempotent: what it produces, it accepts unchanged', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('1990-01-01T00:00:00Z'),
          max: new Date('2100-01-01T00:00:00Z'),
          noInvalidDate: true,
        }),
        (date) => {
          const first = iso(date.toISOString());
          expect(first).toBeDefined();
          expect(iso(first ?? '')).toBe(first);
        },
      ),
    );
  });
});
