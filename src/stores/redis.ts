import type { Redis } from 'ioredis';
import { BucketState, SlidingWindowStore, TokenBucketStore } from '../types';

/**
 * Redis-backed token bucket store — shares limiter state across every
 * instance of your app. Requires `ioredis` (optional peer dependency).
 */
export class RedisTokenBucketStore implements TokenBucketStore {
  constructor(private redis: Redis, private prefix = 'rls:tb:') {}

  async get(key: string): Promise<BucketState | undefined> {
    const raw = await this.redis.get(this.prefix + key);
    if (!raw) return undefined;
    return JSON.parse(raw) as BucketState;
  }

  async set(key: string, state: BucketState, ttlMs: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(state), 'PX', Math.max(ttlMs, 1));
  }
}

/**
 * Redis-backed sliding-window-log store using a ZSET per key.
 * Score = timestamp, member = unique id, so we can prune by score range.
 */
export class RedisSlidingWindowStore implements SlidingWindowStore {
  constructor(private redis: Redis, private prefix = 'rls:sw:') {}

  async recordAndCount(key: string, now: number, windowMs: number): Promise<number> {
    const redisKey = this.prefix + key;
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, now - windowMs);
    pipeline.zadd(redisKey, now, member);
    pipeline.zcard(redisKey);
    pipeline.pexpire(redisKey, windowMs);
    const results = await pipeline.exec();

    // zcard result is the 3rd command (index 2); results is [[err, val], ...]
    const count = results?.[2]?.[1] as number;
    return count ?? 0;
  }
}
