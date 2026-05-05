import type { NextFunction, Request, Response } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  keyPrefix: string;
  windowMs: number;
  max: number;
}

const buckets = new Map<string, RateLimitEntry>();

function cleanupExpiredBuckets(now: number) {
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function createRateLimiter(options: RateLimitOptions) {
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    if (buckets.size > 10_000) {
      cleanupExpiredBuckets(now);
    }

    const key = `${options.keyPrefix}:${req.ip ?? 'unknown'}`;
    const existing = buckets.get(key);
    const current =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + options.windowMs };

    current.count += 1;
    buckets.set(key, current);

    const remaining = Math.max(options.max - current.count, 0);
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

    if (current.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ message: 'Too many requests. Please try again shortly.' });
    }

    next();
  };
}

