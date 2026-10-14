/**
 * Money in this application is a `bigint` count of minor units (cents, wei, ...), or the
 * decimal string ledgerd sends it as. It is never a `number`: JavaScript numbers are
 * 64-bit floats and silently lose integers above 2^53.
 *
 * Nothing in this folder may convert an amount to a `number`; an architecture test and a
 * lint rule enforce that.
 */

/** The largest amount ledgerd accepts in a single posting: 10^30 minor units. */
export const MAX_AMOUNT: bigint = 10n ** 30n;

/** ledgerd stores balances as NUMERIC(38,0): at most 38 digits plus an optional sign. */
const WIRE_INTEGER = /^-?\d{1,38}$/;

/**
 * Reads an integer amount as ledgerd sends it (a string of digits, optionally negative).
 * Throws on anything else, so a malformed answer cannot turn into a wrong number.
 */
export function toBigInt(value: string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (!WIRE_INTEGER.test(value)) {
    throw new RangeError('not an integer amount in minor units');
  }
  return BigInt(value);
}

/** The largest number of decimal places a display scale may have. */
export const MAX_SCALE = 30;

/** True for a whole number from 0 to MAX_SCALE. */
export function isValidScale(scale: number): boolean {
  return scale >= 0 && scale <= MAX_SCALE && scale % 1 === 0;
}
