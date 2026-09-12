export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** ms until the caller should retry, only meaningful when allowed === false */
  retryAfterMs: number;
}

/** A rate limiting strategy — implemented by TokenBucketLimiter and SlidingWindowLimiter */
export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export interface BucketState {
  tokens: number;
  lastRefill: number; // epoch ms
}

/** Storage backend for the token bucket algorithm */
export interface TokenBucketStore {
  get(key: string): Promise<BucketState | undefined>;
  set(key: string, state: BucketState, ttlMs: number): Promise<void>;
}

/** Storage backend for the sliding-window-log algorithm */
export interface SlidingWindowStore {
  /**
   * Record a hit at `now` and return the number of hits within the
   * trailing `windowMs` window (inclusive of the one just recorded).
   */
  recordAndCount(key: string, now: number, windowMs: number): Promise<number>;
}
