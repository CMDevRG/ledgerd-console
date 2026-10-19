/** A time span `[start, end)` in milliseconds. */
export type Interval = readonly [start: number, end: number];

/**
 * The most intervals that overlap at any one moment. An interval is half open, so one that
 * ends exactly when another starts does not overlap it.
 */
export function peakOverlap(intervals: readonly Interval[]): number {
  const events: [time: number, change: 1 | -1][] = [];
  for (const [start, end] of intervals) {
    if (end <= start) continue; // empty
    events.push([start, 1], [end, -1]);
  }
  // At the same instant, what ends is counted out before what starts is counted in.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let peak = 0;
  for (const [, change] of events) {
    open += change;
    if (open > peak) peak = open;
  }
  return peak;
}

/** The parts of a Resource Timing entry that tell when a request was really on the network. */
export interface TimingEntry {
  name: string;
  initiatorType: string;
  startTime: number;
  requestStart: number;
  responseEnd: number;
}

/**
 * How many requests were on the network at once, from the browser's own timings: from the
 * moment a request was actually sent (`requestStart`, after any wait for a free connection) to
 * the end of its answer. Undefined when the browser gave no usable timings.
 */
export function observedInFlight(
  entries: readonly TimingEntry[],
  since: number,
  pathPart = '/api/',
): number | undefined {
  const mine = entries.filter(
    (e) =>
      e.initiatorType === 'fetch' &&
      e.name.includes(pathPart) &&
      e.startTime >= since &&
      e.responseEnd > 0 &&
      e.requestStart > 0,
  );
  if (mine.length === 0) return undefined;
  return peakOverlap(mine.map((e): Interval => [e.requestStart, e.responseEnd]));
}

/** The entries that carry the timings we need; anything else is ignored. */
export function timingEntries(entries: readonly unknown[]): TimingEntry[] {
  return entries.flatMap((e) =>
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    typeof e.name === 'string' &&
    'initiatorType' in e &&
    typeof e.initiatorType === 'string' &&
    'startTime' in e &&
    typeof e.startTime === 'number' &&
    'requestStart' in e &&
    typeof e.requestStart === 'number' &&
    'responseEnd' in e &&
    typeof e.responseEnd === 'number'
      ? [
          {
            name: e.name,
            initiatorType: e.initiatorType,
            startTime: e.startTime,
            requestStart: e.requestStart,
            responseEnd: e.responseEnd,
          },
        ]
      : [],
  );
}
