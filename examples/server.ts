import express from 'express';
import { rateLimit, TokenBucketLimiter, MemoryTokenBucketStore } from '../src';

const app = express();

const limiter = new TokenBucketLimiter({
  capacity: 5, // allow bursts of 5
  refillPerSecond: 1, // then steady-state 1 req/sec
  store: new MemoryTokenBucketStore(),
});

app.use(
  rateLimit({
    limiter,
    keyGenerator: (req) => req.ip ?? 'anonymous',
  })
);

app.get('/', (_req, res) => res.json({ message: 'Hit me up to 5 times fast, then 1/sec.' }));

app.listen(3000, () => console.log('Example server on http://localhost:3000'));
