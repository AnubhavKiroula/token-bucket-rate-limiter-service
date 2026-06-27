import { Router, Request, Response } from 'express';
import { defaultRateLimiter } from '../middleware/rateLimiterMiddleware';

const router = Router();

const handleCheck = async (req: Request, res: Response): Promise<void> => {
  // 1. Extract client key from query params, request body, or header
  const keyRaw = req.query.key || req.body?.key || req.headers['x-client-key'];
  if (!keyRaw) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Missing client "key" parameter in query, body, or headers.',
    });
    return;
  }
  const key = String(keyRaw);

  // 2. Extract potential capacity and refillRate overrides from query params or body
  const capacityRaw = req.query.capacity || req.body?.capacity;
  const refillRateRaw = req.query.refillRate || req.body?.refillRate;

  const customCapacity = capacityRaw ? parseInt(String(capacityRaw), 10) : undefined;
  const customRefillRate = refillRateRaw ? parseFloat(String(refillRateRaw)) : undefined;

  const validCapacity = customCapacity && customCapacity > 0 ? customCapacity : undefined;
  const validRefillRate = customRefillRate && customRefillRate > 0 ? customRefillRate : undefined;

  const instanceId = process.env.INSTANCE_ID || 'localhost';

  try {
    // 3. Consume 1 token asynchronously
    const result = await defaultRateLimiter.consume(key, 1, validRefillRate, validCapacity);

    // 4. Calculate headers
    const remainingInt = Math.max(0, Math.floor(result.tokensRemaining));
    const resetTimeSec = Math.ceil(result.resetTimeMs / 1000);

    res.setHeader('X-RateLimit-Limit', result.capacity);
    res.setHeader('X-RateLimit-Remaining', remainingInt);
    res.setHeader('X-RateLimit-Reset', resetTimeSec);

    const decision = result.allowed ? 'ALLOW' : 'DENY';

    // 5. Structured observability logging in JSON format
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

    // 6. Return response decision and metadata
    res.status(200).json({
      decision,
      key,
      tokensRemaining: result.tokensRemaining,
      capacity: result.capacity,
      refillRate: result.refillRate,
      resetTime: resetTimeSec,
    });
  } catch (err: any) {
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
