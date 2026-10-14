import { isValidScale, toBigInt } from './amount';

export interface FormatOptions {
  /** Group the integer part in threes with commas (12,345.00). Default: false. */
  grouping?: boolean;
}

/**
 * Formats an amount of minor units as major units with exactly `scale` decimals:
 * `formatAmount(10000n, 2)` is `"100.00"`. The digits are exact; negative amounts get a
 * leading minus sign.
 */
export function formatAmount(
  minor: string | bigint,
  scale: number,
  options: FormatOptions = {},
): string {
  if (!isValidScale(scale)) throw new RangeError('scale must be a whole number from 0 to 30');

  const value = toBigInt(minor);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');

  let whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  if (options.grouping === true) whole = groupThousands(whole);

  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

/** The exact minor-unit digits, optionally grouped: the "raw units" view. */
export function formatMinor(minor: string | bigint, options: FormatOptions = {}): string {
  const value = toBigInt(minor);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  return `${negative ? '-' : ''}${options.grouping === true ? groupThousands(digits) : digits}`;
}

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}
