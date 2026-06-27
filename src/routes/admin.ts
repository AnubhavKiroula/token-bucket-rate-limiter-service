import { Router, Request, Response } from 'express';
import { redisStore } from '../store/redisStore';

const router = Router();

router.post('/config', async (req: Request, res: Response): Promise<void> => {
  const { key, capacity, refillRate } = req.body;

  // Validation
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'Bad Request', message: 'Missing or invalid "key" field. Must be a string.' });
    return;
  }

  const parsedCapacity = parseInt(String(capacity), 10);
  const parsedRefillRate = parseFloat(String(refillRate));

  if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
    res.status(400).json({ error: 'Bad Request', message: '"capacity" must be a positive integer.' });
    return;
  }

  if (isNaN(parsedRefillRate) || parsedRefillRate <= 0) {
    res.status(400).json({ error: 'Bad Request', message: '"refillRate" must be a positive number.' });
    return;
  }

  try {
    // Save to Redis store
    await redisStore.saveClientLimitConfig(key, parsedCapacity, parsedRefillRate);

    const instanceId = process.env.INSTANCE_ID || 'localhost';

    // Structured JSON log for observability
    console.log(JSON.stringify({
      level: 'info',
      event: 'admin_config_changed',
      message: `Config override saved for client "${key}"`,
      key,
      capacity: parsedCapacity,
      refillRate: parsedRefillRate,
      instanceId,
    }));

    res.status(200).json({
      success: true,
      message: `Successfully configured rate limits for client: ${key}`,
      config: {
        key,
        capacity: parsedCapacity,
        refillRate: parsedRefillRate,
      },
    });
  } catch (err: any) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'admin_config_error',
      message: err.message || String(err),
    }));

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to save configuration to persistence layer.',
    });
  }
});

export default router;
