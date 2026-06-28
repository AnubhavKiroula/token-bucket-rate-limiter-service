import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../rateLimiter';

/**
 * Initialize a default global rate limiter.
 * By default, permits 10 tokens per second with a burst capacity of 10.
 * Used automatically by rateLimiterMiddleware when no specific limiter is supplied.
 */
export const defaultRateLimiter = new RateLimiter(10, 10);

/**
 * Express middleware factory that wraps a RateLimiter instance.
 * Extracts client identification keys, parses request overrides, handles token consumption,
 * injects standard rate-limit headers (X-RateLimit-*), and applies a secure fail-open strategy.
 * 
 * Connection to app.ts:
 * Mounted globally or on specific sub-routes within `src/app.ts` to inspect incoming HTTP requests.
 * 
 * @param limiter The RateLimiter instance used to evaluate token consumption (defaults to defaultRateLimiter)
 * @returns An Express middleware function matching (req, res, next)
 */
export const rateLimiterMiddleware = (limiter: RateLimiter = defaultRateLimiter) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    
    // Step 1: Identify client key. Resolves in order of priority:
    // 1. HTTP header 'X-Client-Key' (preferred for gateways/proxies)
    // 2. Query parameters 'key' or 'clientKey' (useful for dev testing)
    // 3. Fallback to client IP address (Express-resolved remote address)
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

    // Step 2: Extract potential capacity and refill rate overrides.
    // Supports overrides sent via HTTP Headers (e.g. from upstream gatekeepers) or Query parameters.
    const rawCapacity = req.headers['x-client-capacity'] || req.query.capacity;
    const rawRefillRate = req.headers['x-client-refill-rate'] || req.query.refillRate;

    const customCapacity = rawCapacity ? parseInt(String(rawCapacity), 10) : undefined;
    const customRefillRate = rawRefillRate ? parseFloat(String(rawRefillRate)) : undefined;

    // Validate parsed overrides (ensures positive values to prevent arithmetic errors or negative refills)
    const validCapacity = customCapacity && customCapacity > 0 ? customCapacity : undefined;
    const validRefillRate = customRefillRate && customRefillRate > 0 ? customRefillRate : undefined;

    // Resolve active host identifier for structured cluster logs
    const instanceId = process.env.INSTANCE_ID || 'localhost';

    try {
      // Step 3: Consume 1 token from the bucket
      const result = await limiter.consume(key, 1, validRefillRate, validCapacity);

      // Step 4: Inject Standard HTTP Rate Limit Headers
      // Remaining tokens are rounded down to present clean integers to the client.
      // Reset time is converted to Epoch seconds matching standard HTTP spec patterns.
      const remainingInt = Math.max(0, Math.floor(result.tokensRemaining));
      const resetTimeSec = Math.ceil(result.resetTimeMs / 1000);

      res.setHeader('X-RateLimit-Limit', result.capacity);
      res.setHeader('X-RateLimit-Remaining', remainingInt);
      res.setHeader('X-RateLimit-Reset', resetTimeSec);

      // Step 5: Handle Token consumption decision
      if (result.allowed) {
        // Log ALLOW event in JSON format for search and indexing in log aggregators (Elasticsearch/Splunk)
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
        // Log DENY event as warning
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

        // Return standard HTTP 429 Too Many Requests response with telemetry payload
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
      // Fail-open connection resiliency block:
      // If Redis experiences connection resets, socket timeouts, or internal errors,
      // we log the error event but allow the request to pass. This prevents rate-limiter
      // infrastructure outages from taking down the core business API.
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
