import { formatAmount, formatMinor, toBigInt } from '../money';
import { useScale, useSettings } from '../features/settings/SettingsProvider';

interface AmountProps {
  /** Whole minor units, as ledgerd stores them. */
  minor: string | bigint;
  currency: string;
  /** Overrides the scale from the settings. */
  scale?: number;
}

/**
 * Money, exactly. The digits come from bigint arithmetic in src/money, never from a floating
 * point number. A negative amount has an explicit minus sign and is read as "minus"; it is not
 * marked by colour. With the "raw units" setting on, the whole minor units are shown instead.
 */
export function Amount({ minor, currency, scale }: AmountProps) {
  const [{ rawUnits }] = useSettings();
  const configured = useScale(currency);
  const value = toBigInt(minor);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const digits = rawUnits
    ? formatMinor(magnitude, { grouping: true })
    : formatAmount(magnitude, scale ?? configured, { grouping: true });

  return (
    <span className="whitespace-nowrap font-mono tabular-nums">
      {negative ? (
        <>
          <span aria-hidden="true">-</span>
          <span className="sr-only">minus </span>
        </>
      ) : null}
      {digits}{' '}
      <span className="text-slate-700 dark:text-slate-300">
        {currency}
        {rawUnits ? ' (minor units)' : ''}
      </span>
    </span>
  );
}
