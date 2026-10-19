import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { observedInFlight, peakOverlap, timingEntries, type Interval } from './concurrency';

describe('peakOverlap', () => {
  it('is zero for nothing, and one for a single request', () => {
    expect(peakOverlap([])).toBe(0);
    expect(peakOverlap([[0, 10]])).toBe(1);
  });

  it('counts requests that overlap', () => {
    expect(
      peakOverlap([
        [0, 10],
        [5, 15],
        [8, 20],
      ]),
    ).toBe(3);
    expect(
      peakOverlap([
        [0, 10],
        [5, 15],
        [12, 20],
      ]),
    ).toBe(2);
  });

  it('does not count requests one after the other', () => {
    expect(
      peakOverlap([
        [0, 10],
        [10, 20],
        [20, 30],
      ]),
    ).toBe(1); // one ends as the next starts
    expect(
      peakOverlap([
        [0, 5],
        [6, 10],
      ]),
    ).toBe(1);
  });

  it('ignores empty or backwards spans', () => {
    expect(
      peakOverlap([
        [5, 5],
        [8, 3],
      ]),
    ).toBe(0);
  });

  it('shows a limit: thirty requests, six connections, a peak of six', () => {
    // Six at a time, each taking 10 ms, queued five times over.
    const spans: Interval[] = Array.from({ length: 30 }, (_, i): Interval => {
      const wave = Math.floor(i / 6);
      return [wave * 10, wave * 10 + 10];
    });
    expect(peakOverlap(spans)).toBe(6);
  });

  it('agrees with counting at every instant (property)', () => {
    const span = fc
      .tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }))
      .map(([a, b]): Interval => [Math.min(a, b), Math.max(a, b)]);
    fc.assert(
      fc.property(fc.array(span, { maxLength: 25 }), (spans) => {
        let expected = 0;
        for (let t = 0; t <= 41; t += 0.5) {
          expected = Math.max(expected, spans.filter(([s, e]) => s <= t && t < e).length);
        }
        expect(peakOverlap(spans)).toBe(expected);
      }),
    );
  });

  it('never exceeds the number of requests, and does not depend on their order (property)', () => {
    const span = fc
      .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 30 }))
      .map(([s, d]): Interval => [s, s + d]);
    fc.assert(
      fc.property(fc.array(span, { maxLength: 40 }), (spans) => {
        const peak = peakOverlap(spans);
        expect(peak).toBeLessThanOrEqual(spans.length);
        expect(peakOverlap([...spans].reverse())).toBe(peak);
      }),
    );
  });
});

const entry = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
const base = () => ({
  name: 'http://localhost/api/v1/transactions',
  initiatorType: 'fetch',
  startTime: 10,
  requestStart: 12,
  responseEnd: 40,
});

describe('observedInFlight', () => {
  it('uses the time a request was really sent, not the time it was asked for', () => {
    // Thirty asked for at once, but only sent six at a time: the network never saw more than six.
    const entries = Array.from({ length: 30 }, (_, i) => {
      const wave = Math.floor(i / 6);
      return entry({
        startTime: 10,
        requestStart: 12 + wave * 20,
        responseEnd: 12 + wave * 20 + 18,
      });
    });
    expect(observedInFlight(entries, 0)).toBe(6);
  });

  it('looks only at fetches to the API made since the given moment', () => {
    const entries = [
      entry({ startTime: 1, requestStart: 2, responseEnd: 50 }), // before
      entry({ initiatorType: 'script' }),
      entry({ name: 'http://localhost/assets/app.js' }),
      entry(),
    ];
    expect(observedInFlight(entries, 5)).toBe(1);
  });

  it('is undefined when the browser gave nothing usable', () => {
    expect(observedInFlight([], 0)).toBeUndefined();
    expect(observedInFlight([entry({ requestStart: 0 })], 0)).toBeUndefined(); // not reported
    expect(observedInFlight([entry({ responseEnd: 0 })], 0)).toBeUndefined(); // not finished
  });
});

describe('timingEntries', () => {
  it('keeps what has the timings and drops the rest, whatever else is in the list', () => {
    const good = base();
    const kept = timingEntries([
      good,
      null,
      'x',
      5,
      {},
      { name: 'n' },
      { ...good, requestStart: 'soon' },
    ]);
    expect(kept).toEqual([good]);
  });
});
