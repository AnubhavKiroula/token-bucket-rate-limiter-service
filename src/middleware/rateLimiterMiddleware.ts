import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../rateLimiter';

// Initialize a default global rate limiter: 10 tokens per second, capacity (burst size) of 10
export const defaultRateLimiter = new RateLimiter(10, 10);

/**
 * Creates an Express middleware using a RateLimiter instance.
 */
export const rateLimiterMiddleware = (limiter: RateLimiter = defaultRateLimiter) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    // Validate parsed overrides
    const validCapacity = customCapacity && customCapacity > 0 ? customCapacity : undefined;
    const validRefillRate = customRefillRate && customRefillRate > 0 ? customRefillRate : undefined;

    const instanceId = process.env.INSTANCE_ID || 'localhost';

    try {
      // 3. Consume 1 token asynchronously
      const result = await limiter.consume(key, 1, validRefillRate, validCapacity);

      // 4. Set standard HTTP rate limit headers
      const remainingInt = Math.max(0, Math.floor(result.tokensRemaining));
      const resetTimeSec = Math.ceil(result.resetTimeMs / 1000);

      res.setHeader('X-RateLimit-Limit', result.capacity);
      res.setHeader('X-RateLimit-Remaining', remainingInt);
      res.setHeader('X-RateLimit-Reset', resetTimeSec);

      // 5. Handle rate limiter decision
      if (result.allowed) {
        // Structured JSON log for observability
        console.log(JSON.stringify({
          level: 'info',
          event: 'rate_limit_decision',
          decision: 'ALLOW',
          key,
          tokensRemaining: result.tokensRemaining,
          limit: result.capacity,
          reset: resetTimeSec,
          instanceId,
        }));
        next();
      } else {
        // Structured JSON warning for denied requests
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'rate_limit_decision',
          decision: 'DENY',
          key,
          tokensRemaining: result.tokensRemaining,
          limit: result.capacity,
          reset: resetTimeSec,
          instanceId,
        }));

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
    } catch (err: any) {
      // Fail-open: Log the error, but let the request pass so rate-limiter downtime doesn't take down the service
      console.error(JSON.stringify({
        level: 'error',
        event: 'rate_limiter_middleware_error',
        message: err.message || String(err),
        key,
        instanceId,
      }));
      next();
    }
  };
};
