import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rate-limit';

function limiter(ratePerSecond = 10, burst = 5) {
  let now = 0;
  return {
    limiter: new RateLimiter({ ratePerSecond, burst, now: () => now }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('allows a burst, then refuses', () => {
    const { limiter: l } = limiter(10, 5);
    for (let i = 0; i < 5; i += 1) expect(l.take('a')).toBe(0);
    expect(l.take('a')).toBeGreaterThan(0);
  });

  it('says how long to wait until one request would be allowed', () => {
    const { limiter: l } = limiter(10, 1); // one token every 100 ms
    expect(l.take('a')).toBe(0);
    expect(l.take('a')).toBeCloseTo(0.1, 5);
  });

  it('refills at the configured rate, and never beyond the burst', () => {
    const { limiter: l, advance } = limiter(10, 5);
    for (let i = 0; i < 5; i += 1) l.take('a');
    advance(300); // 3 tokens
    expect(l.take('a')).toBe(0);
    expect(l.take('a')).toBe(0);
    expect(l.take('a')).toBe(0);
    expect(l.take('a')).toBeGreaterThan(0);

    advance(60_000); // a long time: capped at the burst, not 600 tokens
    for (let i = 0; i < 5; i += 1) expect(l.take('a')).toBe(0);
    expect(l.take('a')).toBeGreaterThan(0);
  });

  it('keeps clients apart', () => {
    const { limiter: l } = limiter(10, 2);
    l.take('a');
    l.take('a');
    expect(l.take('a')).toBeGreaterThan(0);
    expect(l.take('b')).toBe(0);
  });

  it('forgets clients that have been idle long enough to be full again', () => {
    const { limiter: l, advance } = limiter(10, 5);
    for (let i = 0; i < 2000; i += 1) l.take(`client-${String(i)}`);
    expect(l.size).toBe(2000);
    advance(10_000);
    l.take('someone-new');
    expect(l.size).toBeLessThan(10);
  });
});
