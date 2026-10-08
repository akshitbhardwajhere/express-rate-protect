import {
  BucketState,
  SlidingWindowStore,
  TokenBucketConsumeOptions,
  TokenBucketConsumeResult,
  TokenBucketStore,
} from "../types";

/**
 * In-memory token bucket store. Good for a single Node process.
 * Not shared across instances — use RedisTokenBucketStore for that.
 */
export class MemoryTokenBucketStore implements TokenBucketStore {
  private buckets = new Map<
    string,
    { state: BucketState; expiresAt: number }
  >();

  async get(key: string): Promise<BucketState | undefined> {
    const entry = this.buckets.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return entry.state;
  }

  async set(key: string, state: BucketState, ttlMs: number): Promise<void> {
    this.buckets.set(key, { state, expiresAt: Date.now() + ttlMs });
  }

  async consume(
    key: string,
    now: number,
    options: TokenBucketConsumeOptions,
  ): Promise<TokenBucketConsumeResult> {
    const existing = this.buckets.get(key);
    const validExisting =
      existing && existing.expiresAt >= now ? existing.state : undefined;
    const last = validExisting?.lastRefill ?? now;
    const refillCount =
      options.refillTime > 0
        ? Math.floor(Math.max(0, now - last) / options.refillTime)
        : 0;
    const refilled = Math.min(
      options.capacity,
      (validExisting?.tokens ?? options.capacity) +
        refillCount * options.refillTokens,
    );
    const lastRefill = validExisting
      ? last + refillCount * options.refillTime
      : now;
    const allowed = refilled >= 1;
    const state = {
      tokens: allowed ? refilled - 1 : refilled,
      lastRefill,
    };

    this.buckets.set(key, { state, expiresAt: now + options.ttlMs });
    return { state, allowed };
  }
}

/**
 * In-memory sliding-window-log store. Keeps a timestamp array per key
 * and prunes anything outside the window on each hit.
 */
export class MemorySlidingWindowStore implements SlidingWindowStore {
  private hits = new Map<string, number[]>();

  async recordAndCount(
    key: string,
    now: number,
    windowMs: number,
  ): Promise<number> {
    const cutoff = now - windowMs;
    const existing = (this.hits.get(key) || []).filter((t) => t > cutoff);
    existing.push(now);
    this.hits.set(key, existing);
    return existing.length;
  }
}
