import type { Redis } from "ioredis";
import {
  BucketState,
  SlidingWindowStore,
  TokenBucketConsumeOptions,
  TokenBucketConsumeResult,
  TokenBucketStore,
} from "../types";

const TOKEN_BUCKET_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local capacity = tonumber(ARGV[1])
local refill_time = tonumber(ARGV[2])
local refill_tokens = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local tokens = capacity
local last_refill = now

if raw then
  local state = cjson.decode(raw)
  tokens = tonumber(state.tokens)
  last_refill = tonumber(state.lastRefill)
  local refill_count = refill_time > 0 and math.floor(math.max(0, now - last_refill) / refill_time) or 0
  tokens = math.min(capacity, tokens + refill_count * refill_tokens)
  last_refill = last_refill + refill_count * refill_time
end

local allowed = tokens >= 1
if allowed then tokens = tokens - 1 end
redis.call('SET', KEYS[1], cjson.encode({ tokens = tokens, lastRefill = last_refill }), 'PX', math.max(tonumber(ARGV[5]), 1))
return { tokens, last_refill, allowed and 1 or 0 }
`;

const SLIDING_WINDOW_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
redis.call('ZADD', KEYS[1], tonumber(ARGV[1]), ARGV[3])
local count = redis.call('ZCARD', KEYS[1])
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[2]), 1))
return count
`;

/**
 * Redis-backed token bucket store — shares limiter state across every
 * instance of your app. Requires `ioredis` (optional peer dependency).
 */
export class RedisTokenBucketStore implements TokenBucketStore {
  constructor(
    private redis: Redis,
    private prefix = "rls:tb:",
  ) {}

  async get(key: string): Promise<BucketState | undefined> {
    const raw = await this.redis.get(this.prefix + key);
    if (!raw) return undefined;
    return JSON.parse(raw) as BucketState;
  }

  async set(key: string, state: BucketState, ttlMs: number): Promise<void> {
    await this.redis.set(
      this.prefix + key,
      JSON.stringify(state),
      "PX",
      Math.max(ttlMs, 1),
    );
  }

  async consume(
    key: string,
    now: number,
    options: TokenBucketConsumeOptions,
  ): Promise<TokenBucketConsumeResult> {
    const result = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      this.prefix + key,
      options.capacity,
      options.refillTime,
      options.refillTokens,
      now,
      options.ttlMs,
    )) as [number, number, number];
    const state = { tokens: Number(result[0]), lastRefill: Number(result[1]) };
    return { state, allowed: Number(result[2]) === 1 };
  }
}

/**
 * Redis-backed sliding-window-log store using a ZSET per key.
 * Score = timestamp, member = unique id, so we can prune by score range.
 */
export class RedisSlidingWindowStore implements SlidingWindowStore {
  constructor(
    private redis: Redis,
    private prefix = "rls:sw:",
  ) {}

  async recordAndCount(
    key: string,
    now: number,
    windowMs: number,
  ): Promise<number> {
    const redisKey = this.prefix + key;
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    const count = await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      redisKey,
      now,
      windowMs,
      member,
    );
    return Number(count);
  }
}
