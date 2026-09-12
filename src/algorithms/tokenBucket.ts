import { RateLimiter, RateLimitResult, TokenBucketStore } from "../types";

interface BaseTokenBucketOptions {
  /** max tokens the bucket can hold (i.e. burst size) */
  capacity: number;
  store: TokenBucketStore;
}

export interface TokenBucketOptions extends BaseTokenBucketOptions {
  /** interval between refills, in milliseconds */
  refillTime: number;
  /** tokens added at each refill interval */
  refillTokens: number;
}

/**
 * Token bucket: allows bursts up to `capacity`, then adds `refillTokens`
 * after each `refillTime` interval.
 */
export class TokenBucketLimiter implements RateLimiter {
  constructor(private opts: TokenBucketOptions) {}

  async check(key: string): Promise<RateLimitResult> {
    const { capacity, refillTime, refillTokens, store } = this.opts;
    const now = Date.now();

    const existing = await store.get(key);
    const last = existing?.lastRefill ?? now;
    const elapsedMs = Math.max(0, now - last);
    const refillCount = refillTime > 0 ? Math.floor(elapsedMs / refillTime) : 0;
    const tokensAdded = refillCount * refillTokens;

    const refilled = Math.min(
      capacity,
      (existing?.tokens ?? capacity) + tokensAdded,
    );
    const lastRefill = existing ? last + refillCount * refillTime : now;

    const allowed = refilled >= 1;
    const tokensAfter = allowed ? refilled - 1 : refilled;

    // Keep state long enough for a depleted bucket to refill completely.
    const ttlMs =
      refillTime > 0 && refillTokens > 0
        ? Math.ceil(capacity / refillTokens) * refillTime + 1000
        : 60_000;
    await store.set(key, { tokens: tokensAfter, lastRefill }, ttlMs);

    const retryAfterMs =
      allowed || refillTime <= 0 || refillTokens <= 0
        ? 0
        : Math.max(0, refillTime - (now - lastRefill));

    return {
      allowed,
      limit: capacity,
      remaining: Math.floor(tokensAfter),
      retryAfterMs,
    };
  }
}
