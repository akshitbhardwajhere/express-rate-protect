import { RateLimiter, RateLimitResult, SlidingWindowStore } from '../types';

export interface SlidingWindowOptions {
  /** max requests allowed within the window */
  limit: number;
  windowMs: number;
  store: SlidingWindowStore;
}

/**
 * Sliding window log: tracks exact request timestamps within the
 * trailing window. No burst edge cases at window boundaries (unlike
 * fixed windows), at the cost of storing one entry per request.
 */
export class SlidingWindowLimiter implements RateLimiter {
  constructor(private opts: SlidingWindowOptions) {}

  async check(key: string): Promise<RateLimitResult> {
    const { limit, windowMs, store } = this.opts;
    const now = Date.now();

    const count = await store.recordAndCount(key, now, windowMs);
    const allowed = count <= limit;

    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - count),
      // Simplification: since we don't track individual timestamps here,
      // suggest retrying after the full window elapses.
      retryAfterMs: allowed ? 0 : windowMs,
    };
  }
}
