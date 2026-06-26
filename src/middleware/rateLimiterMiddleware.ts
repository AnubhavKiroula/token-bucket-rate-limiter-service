import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../rateLimiter';

// Initialize a default global rate limiter: 10 tokens per second, capacity (burst size) of 10
export const defaultRateLimiter = new RateLimiter(10, 10);

/**
 * Creates an Express middleware using a RateLimiter instance.
 */
export const rateLimiterMiddleware = (limiter: RateLimiter = defaultRateLimiter) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Identify client key (header, query param, or IP address)
    let key = 'anonymous';
    if (req.headers['x-client-key']) {
      key = String(req.headers['x-client-key']);
    } else if (req.query.key) {
      key = String(req.query.key);
    } else if (req.query.clientKey) {
      key = String(req.query.clientKey);
    } else if (req.ip) {
      key = req.ip;
    }

    // 2. Extract potential capacity & refillRate overrides from headers or query params
    const rawCapacity = req.headers['x-client-capacity'] || req.query.capacity;
    const rawRefillRate = req.headers['x-client-refill-rate'] || req.query.refillRate;

    const customCapacity = rawCapacity ? parseInt(String(rawCapacity), 10) : undefined;
    const customRefillRate = rawRefillRate ? parseFloat(String(rawRefillRate)) : undefined;

    // Validate parsed overrides (ensure they are positive numbers)
    const validCapacity = customCapacity && customCapacity > 0 ? customCapacity : undefined;
    const validRefillRate = customRefillRate && customRefillRate > 0 ? customRefillRate : undefined;

    // 3. Consume 1 token
    const result = limiter.consume(key, 1, validRefillRate, validCapacity);

    // 4. Set standard HTTP rate limit headers
    const remainingInt = Math.max(0, Math.floor(result.tokensRemaining));
    const resetTimeSec = Math.ceil(result.resetTimeMs / 1000);

    res.setHeader('X-RateLimit-Limit', result.capacity);
    res.setHeader('X-RateLimit-Remaining', remainingInt);
    res.setHeader('X-RateLimit-Reset', resetTimeSec);

    // 5. Handle rate limiter decision
    if (result.allowed) {
      // Structured observability log
      console.log(`[RateLimit] ALLOW key="${key}" remaining=${result.tokensRemaining.toFixed(2)} limit=${result.capacity} reset=${resetTimeSec}`);
      next();
    } else {
      console.warn(`[RateLimit] DENY key="${key}" remaining=${result.tokensRemaining.toFixed(2)} limit=${result.capacity} reset=${resetTimeSec}`);
      
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        key,
        tokensRemaining: result.tokensRemaining,
        capacity: result.capacity,
        refillRate: result.refillRate,
        resetTime: resetTimeSec,
      });
    }
  };
};
