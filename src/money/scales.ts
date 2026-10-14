import { isValidScale } from './amount';

/**
 * How many decimal places a currency shows. ledgerd does not know this (it stores whole
 * minor units); it is a presentation choice, so users can change it in the settings.
 */
export const DEFAULT_SCALES: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  USDT: 6,
  USDC: 6,
  BTC: 8,
  ETH: 18,
};

/** The scale used for a currency we know nothing about. */
export const FALLBACK_SCALE = 2;

export function defaultScale(currency: string): number {
  return DEFAULT_SCALES[currency] ?? FALLBACK_SCALE;
}

/** The scale to use for a currency: the user's override if it is valid, otherwise the default. */
export function resolveScale(
  currency: string,
  overrides: Readonly<Record<string, number>>,
): number {
  const override = overrides[currency];
  return override !== undefined && isValidScale(override) ? override : defaultScale(currency);
}
