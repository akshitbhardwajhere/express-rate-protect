import type { NextFunction, Request, Response } from 'express';
import { RateLimiter } from './types';

export interface RateLimitMiddlewareOptions {
  limiter: RateLimiter;
  /** Derive the key to rate-limit on. Defaults to req.ip. */
  keyGenerator?: (req: Request) => string;
  /** Called instead of sending a 429, if you want custom handling. */
  onLimitExceeded?: (req: Request, res: Response, retryAfterMs: number) => void;
  /** Skip rate limiting entirely for certain requests (health checks, etc). */
  skip?: (req: Request) => boolean;
}

/**
 * Express middleware that enforces a RateLimiter (token bucket or
 * sliding window) and sets standard rate-limit response headers.
 */
export function rateLimit(options: RateLimitMiddlewareOptions) {
  const keyGenerator = options.keyGenerator ?? ((req: Request) => req.ip ?? 'unknown');

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    if (options.skip?.(req)) return next();

    try {
      const key = keyGenerator(req);
      const result = await options.limiter.check(key);

      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));
        if (options.onLimitExceeded) {
          return options.onLimitExceeded(req, res, result.retryAfterMs);
        }
        return res.status(429).json({
          error: 'Too Many Requests',
          retryAfterMs: result.retryAfterMs,
        });
      }

      return next();
    } catch (err) {
      // Fail open: a broken store (e.g. Redis blip) shouldn't take down the API.
      // Log so it's visible, but let the request through.
      // eslint-disable-next-line no-console
      console.error('[express-rate-shield] store error, failing open:', err);
      return next();
    }
  };
}
