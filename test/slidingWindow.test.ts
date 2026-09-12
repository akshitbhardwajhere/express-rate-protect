import { SlidingWindowLimiter } from '../src/algorithms/slidingWindow';
import { MemorySlidingWindowStore } from '../src/stores/memory';

describe('SlidingWindowLimiter', () => {
  it('allows requests up to the limit within the window', async () => {
    const limiter = new SlidingWindowLimiter({
      limit: 2,
      windowMs: 1000,
      store: new MemorySlidingWindowStore(),
    });

    const r1 = await limiter.check('user-1');
    const r2 = await limiter.check('user-1');
    const r3 = await limiter.check('user-1');

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
  });

  it('evicts old hits once the window passes', async () => {
    jest.useFakeTimers();
    const limiter = new SlidingWindowLimiter({
      limit: 1,
      windowMs: 500,
      store: new MemorySlidingWindowStore(),
    });

    const r1 = await limiter.check('user-2');
    expect(r1.allowed).toBe(true);

    const r2 = await limiter.check('user-2');
    expect(r2.allowed).toBe(false);

    jest.setSystemTime(Date.now() + 600); // past the window
    const r3 = await limiter.check('user-2');
    expect(r3.allowed).toBe(true);

    jest.useRealTimers();
  });
});
