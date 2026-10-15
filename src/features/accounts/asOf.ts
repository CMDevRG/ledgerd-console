/**
 * The "as of" instant of a balance query. People type it as `2026-10-01 10:00`; ledgerd wants
 * RFC 3339. This turns the first into the second, always in UTC, and refuses what is not a
 * real moment (there is no 30 February). Everything shown in the console is UTC, so what
 * is typed without a zone is UTC too.
 */
export type AsOfResult = { ok: true; iso: string } | { ok: false; message: string };

export const AS_OF_RULE =
  'Use a date and time such as 2026-10-01 10:00 (UTC) or 2026-10-01T10:00:00Z';

// year-month-day, then T or a space, then hour:minute[:second[.fraction]], then Z or ±hh:mm or nothing
const PATTERN =
  /^([1-9]\d{3})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

export function parseAsOf(text: string): AsOfResult {
  const fail: AsOfResult = { ok: false, message: AS_OF_RULE };
  const match = PATTERN.exec(text.trim());
  if (match === null) return fail;

  const [, y, mo, d, h, mi, s = '00', fraction = '', zone = 'Z'] = match;
  const parts = [y, mo, d, h, mi, s].map((p) => Number.parseInt(p ?? '', 10));
  const [year, month, day, hour, minute, second] = parts as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // Check the fields as written: Date.UTC would quietly carry 30 February into March.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    // Date.UTC carries a day that does not exist (30 February) into the next month, so a
    // changed month means the date was not real. (Day 0 carries back, day 32 forward.)
    calendar.getUTCMonth() !== month - 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return fail;
  }

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHours = Number.parseInt(zone.slice(1, 3), 10);
    const offsetMins = Number.parseInt(zone.slice(4, 6), 10);
    if (offsetHours > 23 || offsetMins > 59) return fail;
    offsetMinutes = (zone.startsWith('-') ? -1 : 1) * (offsetHours * 60 + offsetMins);
  }

  const instant = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000,
  );
  if (instant.getUTCFullYear() < 1000) return fail;
  return { ok: true, iso: `${instant.toISOString().slice(0, 19)}${fraction}Z` };
}
