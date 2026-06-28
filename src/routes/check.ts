import { Router, Request, Response } from 'express';
import { defaultRateLimiter } from '../middleware/rateLimiterMiddleware';

const router = Router();

/**
 * Controller handler to process rate limit verification queries.
 * Accessible via both GET and POST HTTP verbs.
 * Parses the client identity key, checks capacity/refill overrides, performs token consumption checks,
 * logs the decision dynamically, and returns JSON payload detailing token states and headers.
 * 
 * Connection to other files:
 * - Uses `defaultRateLimiter` imported from `rateLimiterMiddleware.ts` to perform core token calculations.
 * - Mounted under `/check` in `src/app.ts`.
 * 
 * @param req Express Request object
 * @param res Express Response object
 */
const handleCheck = async (req: Request, res: Response): Promise<void> => {
  // Step 1: Extract client key. Resolves in order of priority:
  // 1. Query parameters (?key=...)
  // 2. JSON request body ({"key": "..."})
  // 3. HTTP Header ('x-client-key')
  const keyRaw = req.query.key || req.body?.key || req.headers['x-client-key'];
  if (!keyRaw) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Missing client "key" parameter in query, body, or headers.',
    });
    return;
  }
  const key = String(keyRaw);

  // Step 2: Extract potential capacity and refill rate overrides.
  // Supports custom limits passed during live checks via URL parameters or JSON request body payload.
  const capacityRaw = req.query.capacity || req.body?.capacity;
  const refillRateRaw = req.query.refillRate || req.body?.refillRate;

  const customCapacity = capacityRaw ? parseInt(String(capacityRaw), 10) : undefined;
  const customRefillRate = refillRateRaw ? parseFloat(String(refillRateRaw)) : undefined;

  // Validate overrides to prevent negative rate capacities
  const validCapacity = customCapacity && customCapacity > 0 ? customCapacity : undefined;
  const validRefillRate = customRefillRate && customRefillRate > 0 ? customRefillRate : undefined;

  // Identify container hostname for structured log context
  const instanceId = process.env.INSTANCE_ID || 'localhost';

  try {
    // Step 3: Consume 1 token from the bucket
    const result = await defaultRateLimiter.consume(key, 1, validRefillRate, validCapacity);

    // Step 4: Calculate header values
    // Floor tokens remaining to display integer counts.
    // Convert reset timestamp to Epoch seconds.
    const remainingInt = Math.max(0, Math.floor(result.tokensRemaining));
    const resetTimeSec = Math.ceil(result.resetTimeMs / 1000);

    res.setHeader('X-RateLimit-Limit', result.capacity);
    res.setHeader('X-RateLimit-Remaining', remainingInt);
    res.setHeader('X-RateLimit-Reset', resetTimeSec);

    const decision = result.allowed ? 'ALLOW' : 'DENY';

    // Step 5: Structured logging for indexing/dashboards
    if (result.allowed) {
      console.log(JSON.stringify({
        level: 'info',
        event: 'rate_limit_check',
        decision: 'ALLOW',
        key,
        tokensRemaining: result.tokensRemaining,
        limit: result.capacity,
        reset: resetTimeSec,
        instanceId,
      }));
    } else {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'rate_limit_check',
        decision: 'DENY',
        key,
        tokensRemaining: result.tokensRemaining,
        limit: result.capacity,
        reset: resetTimeSec,
        instanceId,
      }));
    }

    // Step 6: Return final JSON decision and telemetry payload
    res.status(200).json({
      decision,
      key,
      tokensRemaining: result.tokensRemaining,
      capacity: result.capacity,
      refillRate: result.refillRate,
      resetTime: resetTimeSec,
    });
  } catch (err: any) {
    // Log unexpected errors
    console.error(JSON.stringify({
      level: 'error',
      event: 'rate_limit_check_error',
      message: err.message || String(err),
      key,
      instanceId,
    }));

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process rate limiting check.',
    });
  }
};

// Bind both GET and POST requests to the /check handler
router.get('/', handleCheck);
router.post('/', handleCheck);

export default router;
