import { TokenBucketLimiter } from "../src/algorithms/tokenBucket";
import { MemoryTokenBucketStore } from "../src/stores/memory";

describe("TokenBucketLimiter", () => {
  it("allows requests up to capacity, then blocks", async () => {
    const limiter = new TokenBucketLimiter({
      capacity: 3,
      refillTime: 1000,
      refillTokens: 0,
      store: new MemoryTokenBucketStore(),
    });

    const r1 = await limiter.check("user-1");
    const r2 = await limiter.check("user-1");
    const r3 = await limiter.check("user-1");
    const r4 = await limiter.check("user-1");

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
  });

  it("refills tokens over time", async () => {
    jest.useFakeTimers();
    const store = new MemoryTokenBucketStore();
    const limiter = new TokenBucketLimiter({
      capacity: 1,
      refillTime: 1000,
      refillTokens: 1,
      store,
    });

    const r1 = await limiter.check("user-2");
    expect(r1.allowed).toBe(true);

    const r2 = await limiter.check("user-2");
    expect(r2.allowed).toBe(false);

    jest.setSystemTime(Date.now() + 1100); // advance just over 1 refill interval
    const r3 = await limiter.check("user-2");
    expect(r3.allowed).toBe(true);

    jest.useRealTimers();
  });

  it("supports a configurable refill interval and token count", async () => {
    jest.useFakeTimers();
    const limiter = new TokenBucketLimiter({
      capacity: 4,
      refillTime: 1000,
      refillTokens: 2,
      store: new MemoryTokenBucketStore(),
    });

    await limiter.check("user-interval");
    await limiter.check("user-interval");
    await limiter.check("user-interval");
    await limiter.check("user-interval");
    expect((await limiter.check("user-interval")).allowed).toBe(false);

    jest.setSystemTime(Date.now() + 500);
    expect((await limiter.check("user-interval")).allowed).toBe(false);

    jest.setSystemTime(Date.now() + 500);
    expect((await limiter.check("user-interval")).allowed).toBe(true);
    expect((await limiter.check("user-interval")).allowed).toBe(true);
    expect((await limiter.check("user-interval")).allowed).toBe(false);

    jest.useRealTimers();
  });

  it("tracks separate buckets per key", async () => {
    const limiter = new TokenBucketLimiter({
      capacity: 1,
      refillTime: 1000,
      refillTokens: 0,
      store: new MemoryTokenBucketStore(),
    });

    const a1 = await limiter.check("user-a");
    const b1 = await limiter.check("user-b");

    expect(a1.allowed).toBe(true);
    expect(b1.allowed).toBe(true);
  });
});
