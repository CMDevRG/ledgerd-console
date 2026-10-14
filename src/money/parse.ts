import { isValidScale, MAX_AMOUNT } from './amount';

export type MoneyErrorCode =
  | 'empty'
  | 'padding'
  | 'sign'
  | 'exponent'
  | 'separator'
  | 'malformed'
  | 'too_many_decimals'
  | 'zero'
  | 'too_large';

export interface MoneyError {
  code: MoneyErrorCode;
  message: string;
}

export type ParseResult = { ok: true; value: bigint } | { ok: false; error: MoneyError };

const fail = (code: MoneyErrorCode, message: string): ParseResult => ({
  ok: false,
  error: { code, message },
});

/** ASCII digits, an optional fraction. No sign, exponent, separator or padding. */
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** More digits than this cannot be a valid amount, so we stop before building huge numbers. */
const MAX_INPUT_DIGITS = 80;

/**
 * Reads an amount typed in major units ("100.50") and returns it in minor units (10050n)
 * with the given number of decimal places, exactly. No floating point is involved.
 *
 * The input is rejected, with a specific reason, if it is empty, padded with spaces,
 * signed, in exponent form, uses a thousands or comma separator, is not a plain decimal
 * number, has more decimals than `scale`, is zero, or exceeds 10^30 minor units.
 */
export function parseAmount(text: string, scale: number): ParseResult {
  if (!isValidScale(scale)) throw new RangeError('scale must be a whole number from 0 to 30');

  if (text === '') return fail('empty', 'Enter an amount.');
  if (text !== text.trim()) return fail('padding', 'Remove the spaces around the amount.');
  if (text.startsWith('+') || text.startsWith('-')) {
    return fail(
      'sign',
      'Enter a positive amount without a sign. The direction is chosen separately.',
    );
  }
  if (/[eE]/.test(text))
    return fail('exponent', 'Write the amount in plain digits, not in exponent form.');
  if (text.includes(',')) {
    return fail(
      'separator',
      'Use a dot for decimals and no thousands separators, for example 1250.50.',
    );
  }

  const match = DECIMAL.exec(text);
  if (!match)
    return fail(
      'malformed',
      'Enter digits with an optional decimal part, for example 100 or 100.50.',
    );

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';

  if (fraction.length > scale) {
    return fail(
      'too_many_decimals',
      scale === 0
        ? 'This currency has no decimal places.'
        : `This currency allows at most ${String(scale)} decimal places.`,
    );
  }
  if (whole.length + scale > MAX_INPUT_DIGITS) return fail('too_large', tooLarge);

  const minor = BigInt(whole + fraction.padEnd(scale, '0'));
  if (minor === 0n) return fail('zero', 'The amount must be greater than zero.');
  if (minor > MAX_AMOUNT) return fail('too_large', tooLarge);
  return { ok: true, value: minor };
}

const tooLarge = 'The amount is larger than the maximum of 10^30 minor units.';
