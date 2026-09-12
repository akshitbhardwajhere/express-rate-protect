import express from 'express';
import request from 'supertest';
import { rateLimit } from '../src/middleware';
import { TokenBucketLimiter } from '../src/algorithms/tokenBucket';
import { MemoryTokenBucketStore } from '../src/stores/memory';

function buildApp() {
  const app = express();
  const limiter = new TokenBucketLimiter({
    capacity: 2,
    refillPerSecond: 0,
    store: new MemoryTokenBucketStore(),
  });

  app.use(rateLimit({ limiter, keyGenerator: () => 'fixed-key' }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('returns 429 with headers once the limit is hit', async () => {
    const app = buildApp();

    const r1 = await request(app).get('/ping');
    const r2 = await request(app).get('/ping');
    const r3 = await request(app).get('/ping');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers['retry-after']).toBeDefined();
    expect(r3.body.error).toBe('Too Many Requests');
  });

  it('sets X-RateLimit-* headers on every response', async () => {
    const app = buildApp();
    const res = await request(app).get('/ping');

    expect(res.headers['x-ratelimit-limit']).toBe('2');
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });
});
