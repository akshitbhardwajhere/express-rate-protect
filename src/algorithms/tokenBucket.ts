import { RateLimiter, RateLimitResult, TokenBucketStore } from '../types';

export interface TokenBucketOptions {
  /** max tokens the bucket can hold (i.e. burst size) */
  capacity: number;
  /** tokens added per second */
  refillPerSecond: number;
  store: TokenBucketStore;
}

/**
 * Token bucket: allows bursts up to `capacity`, then throttles to a
 * steady `refillPerSecond` rate. Good default for APIs that want to
 * tolerate short spikes without hard-blocking every extra request.
 */
export class TokenBucketLimiter implements RateLimiter {
  constructor(private opts: TokenBucketOptions) {}

  async check(key: string): Promise<RateLimitResult> {
    const { capacity, refillPerSecond, store } = this.opts;
    const now = Date.now();

    const existing = await store.get(key);
    const last = existing?.lastRefill ?? now;
    const elapsedSeconds = Math.max(0, (now - last) / 1000);

    const refilled = Math.min(capacity, (existing?.tokens ?? capacity) + elapsedSeconds * refillPerSecond);

    const allowed = refilled >= 1;
    const tokensAfter = allowed ? refilled - 1 : refilled;

    // bucket state is only meaningful for `capacity / refillPerSecond` seconds
    // after the last write, so TTL a little beyond a full refill cycle
    const ttlMs = Math.ceil((capacity / refillPerSecond) * 1000) + 1000;
    await store.set(key, { tokens: tokensAfter, lastRefill: now }, ttlMs);

    const missingTokens = Math.max(0, 1 - refilled);
    const retryAfterMs = allowed ? 0 : Math.ceil((missingTokens / refillPerSecond) * 1000);

    return {
      allowed,
      limit: capacity,
      remaining: Math.floor(tokensAfter),
      retryAfterMs,
    };
  }
}
