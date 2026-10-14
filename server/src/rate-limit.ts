/**
 * A token bucket per client. Each client may make `burst` requests at once and then
 * `ratePerSecond` per second on average. Time is injected so tests do not sleep.
 */
export class RateLimiter {
  readonly #ratePerSecond: number;
  readonly #burst: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(options: { ratePerSecond: number; burst: number; now?: () => number }) {
    this.#ratePerSecond = options.ratePerSecond;
    this.#burst = options.burst;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Takes one token for `client`. Returns 0 if allowed, otherwise the seconds to wait. */
  take(client: string): number {
    const now = this.#now();
    const bucket = this.#buckets.get(client) ?? { tokens: this.#burst, updatedAt: now };
    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(this.#burst, bucket.tokens + elapsedSeconds * this.#ratePerSecond);
    bucket.updatedAt = now;

    let wait = 0;
    if (bucket.tokens >= 1) bucket.tokens -= 1;
    else wait = (1 - bucket.tokens) / this.#ratePerSecond;

    this.#buckets.set(client, bucket);
    this.#forgetIdleClients(now);
    return wait;
  }

  /** Clients that have been idle long enough to be back at a full bucket need no entry. */
  #forgetIdleClients(now: number): void {
    if (this.#buckets.size < 1024) return;
    const refillMs = (this.#burst / this.#ratePerSecond) * 1000;
    for (const [client, bucket] of this.#buckets) {
      if (now - bucket.updatedAt > refillMs) this.#buckets.delete(client);
    }
  }

  /** Number of clients currently tracked (for tests). */
  get size(): number {
    return this.#buckets.size;
  }
}
