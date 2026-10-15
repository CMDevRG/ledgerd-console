const RFC3339_UTC = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/;

/**
 * `2026-10-13 15:04:05.123 UTC` for ledgerd's `2026-10-13T15:04:05.123456Z`. Always UTC, so
 * what is shown is what the `as_of` filter takes. Anything else is shown as it came.
 */
export function formatTimestamp(iso: string): string {
  const match = RFC3339_UTC.exec(iso);
  if (match === null) return iso;
  const [, date, time, fraction] = match;
  return `${date ?? ''} ${time ?? ''}${fraction === undefined ? '' : fraction.slice(0, 4)} UTC`;
}

export function Time({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={iso} className="whitespace-nowrap tabular-nums">
      {formatTimestamp(iso)}
    </time>
  );
}
