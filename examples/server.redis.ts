import express from 'express';
import Redis from 'ioredis';
import { rateLimit, SlidingWindowLimiter, RedisSlidingWindowStore } from '../src';

const app = express();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

// Sliding window is a good fit when you want a hard, precise cap
// (e.g. "100 requests per minute, no bursts") shared across instances.
const limiter = new SlidingWindowLimiter({
  limit: 100,
  windowMs: 60_000,
  store: new RedisSlidingWindowStore(redis),
});

app.use(rateLimit({ limiter, keyGenerator: (req) => req.header('x-api-key') ?? req.ip ?? 'anon' }));

app.get('/', (_req, res) => res.json({ message: '100 requests/min, shared across every instance.' }));

app.listen(3000, () => console.log('Redis-backed example server on http://localhost:3000'));
