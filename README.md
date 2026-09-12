# express-rate-protect

Rate-limiting middleware for Express, implemented from scratch — not a
wrapper around `express-rate-limit`. It supports two limiting algorithms
(token bucket and sliding window log) and two storage backends (in-memory
and Redis), which can be combined depending on your use case.

## What rate limiting actually does

Rate limiting restricts how many requests a client (identified by IP,
user ID, API key, etc.) can make within a given time period. Without it, a
single client — malicious or just buggy — can send unlimited requests and
degrade performance for everyone else, or successfully brute-force
endpoints like login forms.

A rate limiter sits as middleware in front of your route handlers. On each
incoming request, it checks whether the client has exceeded their allotted
quota. If they have, the middleware short-circuits the request with an
HTTP `429 Too Many Requests` response, before your route handler ever
executes. If not, the request passes through normally.

## The two algorithms

### Token Bucket

Each client has a virtual "bucket" holding up to `capacity` tokens. Every
request consumes one token. Every `refillTime` milliseconds, exactly
`refillTokens` are added, up to the bucket's capacity.

```
capacity: 5, refillTime: 1000, refillTokens: 1

t=0s   → 5 requests fire instantly → all allowed (bucket: 5 → 0)
t=0s   → 6th request               → rejected (0 tokens available)
t=1s   → 1 token has regenerated   → 1 request allowed
```

**Characteristics:**

- Allows short bursts up to `capacity`, then adds `refillTokens` at each
  `refillTime` interval.
- O(1) storage per client — just `{ tokens, lastRefill }`.
- Good fit for public APIs where traffic is naturally bursty (page loads
  firing several requests at once) but you still want to cap sustained
  throughput.

### Sliding Window Log

Each client has a log of request timestamps. On every request, timestamps
older than `windowMs` are pruned, then the remaining count is compared
against `limit`.

```
limit: 3, windowMs: 10_000ms

t=0s  → request 1 → allowed (log: [0])
t=2s  → request 2 → allowed (log: [0, 2])
t=4s  → request 3 → allowed (log: [0, 2, 4])
t=5s  → request 4 → rejected (3 requests already in the last 10s)
t=11s → request 5 → allowed (t=0 timestamp is now >10s old, pruned)
```

**Characteristics:**

- Exact enforcement over any rolling window — no boundary effects like
  fixed-window counters have (where a client could send `2 × limit`
  requests by timing them around a window edge).
- O(n) storage per client where n = requests in the current window; the
  Redis implementation uses a ZSET so pruning is O(log n) via
  `ZREMRANGEBYSCORE`.
- Good fit where the limit must be strictly enforced — billing tiers,
  contractual SLAs, security-sensitive endpoints.

**Choosing between them:** token bucket if you want to tolerate bursts;
sliding window if you need a hard cap that's never exceeded, even
temporarily.

## The two storage backends

### `MemoryTokenBucketStore` / `MemorySlidingWindowStore`

State is kept in a `Map` in the Node process's own memory. Zero
dependencies, lowest latency. The limitation: state isn't shared across
processes. If you run multiple instances of your app (e.g. behind a load
balancer, or in a container replica set), each instance enforces the
limit independently — a client could get `N × limit` total throughput by
distributing requests across `N` instances.

### `RedisTokenBucketStore` / `RedisSlidingWindowStore`

State is stored in Redis instead of local memory, so every instance of
your app reads and writes the same counters. This is required once you
scale horizontally — otherwise the "shared" limit isn't actually shared.
Requires `ioredis` (declared as an optional peer dependency, not bundled).

**Rule of thumb:** in-memory for a single instance or local development;
Redis-backed as soon as you run more than one instance of the app.

## Where to apply the middleware

`rateLimit()` returns a standard Express middleware function, so it
composes exactly the way any other middleware does.

**Global — every route shares one limiter:**

```ts
app.use(rateLimit({ limiter }));
```

**Single route:**

```ts
app.get("/api/search", rateLimit({ limiter: searchLimiter }), searchHandler);
```

**Path prefix — a group of routes:**

```ts
app.use("/api/", rateLimit({ limiter }));
```

**Per-route limiters with different rules — the common production
pattern.** Authentication endpoints typically need a much tighter limit
than public read endpoints, since they're a brute-force target:

```ts
const strictLimiter = new TokenBucketLimiter({
  capacity: 3,
  refillTime: 10_000,
  refillTokens: 1, // one token every 10s after the burst
  store: new MemoryTokenBucketStore(),
});

const relaxedLimiter = new TokenBucketLimiter({
  capacity: 100,
  refillTime: 1000,
  refillTokens: 5,
  store: new MemoryTokenBucketStore(),
});

app.post("/api/login", rateLimit({ limiter: strictLimiter }), loginHandler);
app.get(
  "/api/products",
  rateLimit({ limiter: relaxedLimiter }),
  productsHandler,
);
```

Each `Limiter` instance maintains isolated state. Two routes sharing the
same limiter instance also share the same quota; separate instances mean
separate, independent quotas.

## Install

```bash
npm install express-rate-protect
# ioredis is an optional peer dependency, only needed for the Redis stores
npm install ioredis
```

## Quick start — single instance, token bucket

```ts
import express from "express";
import {
  rateLimit,
  TokenBucketLimiter,
  MemoryTokenBucketStore,
} from "express-rate-protect";

const app = express();

const limiter = new TokenBucketLimiter({
  capacity: 5,
  refillTime: 1000,
  refillTokens: 1,
  store: new MemoryTokenBucketStore(),
});

app.use(rateLimit({ limiter }));
```

## Quick start — horizontally scaled, sliding window over Redis

```ts
import Redis from "ioredis";
import {
  rateLimit,
  SlidingWindowLimiter,
  RedisSlidingWindowStore,
} from "express-rate-protect";

const redis = new Redis(process.env.REDIS_URL);

const limiter = new SlidingWindowLimiter({
  limit: 100,
  windowMs: 60_000, // 100 req/min, enforced consistently across every instance
  store: new RedisSlidingWindowStore(redis),
});

app.use(
  rateLimit({
    limiter,
    keyGenerator: (req) => req.header("x-api-key") ?? req.ip ?? "anonymous",
  }),
);
```

## API reference

### `rateLimit(options)`

| Option            | Type                               | Description                                                                                                                     |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `limiter`         | `RateLimiter`                      | A `TokenBucketLimiter` or `SlidingWindowLimiter` instance                                                                       |
| `keyGenerator`    | `(req) => string`                  | Derives the identity to rate-limit on. Defaults to `req.ip`. Use a user ID or API key for per-account limits instead of per-IP. |
| `skip`            | `(req) => boolean`                 | Return `true` to bypass the check entirely (e.g. health-check routes)                                                           |
| `onLimitExceeded` | `(req, res, retryAfterMs) => void` | Override the default `429` JSON response with custom handling                                                                   |

Every response — allowed or not — includes `X-RateLimit-Limit` and
`X-RateLimit-Remaining`. Rejected responses additionally include
`Retry-After` (seconds).

### Design decisions

- **Fails open on store errors.** If Redis is unreachable or throws, the
  request is allowed through rather than blocking the entire API on an
  infrastructure fault. The error is logged so it's visible in monitoring,
  but availability is prioritized over strict enforcement during an
  outage.
- **Storage is abstracted behind small interfaces** (`TokenBucketStore`,
  `SlidingWindowStore`), so a different backend (Postgres, DynamoDB, etc.)
  can be implemented without touching the algorithm logic.
- **The sliding window's Redis implementation uses a ZSET** with the
  timestamp as score, pruned via `ZREMRANGEBYSCORE` on every request —
  avoiding unbounded growth of stored history.

## Development

```bash
npm install
npm test        # jest — unit tests for both algorithms + integration test via supertest
npm run build   # compiles src/ → dist/ with tsc
npm run dev     # runs examples/server.ts
```

## Why this exists

Built to work through the actual tradeoffs of rate limiting — burst
tolerance vs. strict enforcement, and single-instance vs. distributed
state — rather than depending on an existing library without
understanding what it's doing internally.

## License

MIT
