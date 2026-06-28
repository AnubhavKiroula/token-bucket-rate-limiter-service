import { Router, Request, Response } from 'express';
import path from 'path';
import { redisStore } from '../store/redisStore';

const router = Router();

/**
 * Configure rate limit overrides for a specific client key.
 */
router.post('/config', async (req: Request, res: Response): Promise<void> => {
  const { key, capacity, refillRate } = req.body;

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
    await redisStore.saveClientLimitConfig(key, parsedCapacity, parsedRefillRate);

    const instanceId = process.env.INSTANCE_ID || 'localhost';

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

/**
 * Fetch current aggregated metrics.
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await redisStore.getMetrics();
    res.status(200).json(metrics);
  } catch (err: any) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch rate limiter statistics.',
    });
  }
});

/**
 * Server-Sent Events (SSE) stream endpoint to push real-time rate limiter telemetry.
 */
router.get('/stats/live', (req: Request, res: Response): void => {
  // Establish persistent SSE connection
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendUpdate = async () => {
    try {
      const metrics = await redisStore.getMetrics();
      res.write(`data: ${JSON.stringify(metrics)}\n\n`);
    } catch (err) {
      // Suppress metrics gathering errors in live stream
    }
  };

  // Push immediate initial state
  sendUpdate();

  // Poll Redis and push metrics every 1000ms
  const intervalId = setInterval(sendUpdate, 1000);

  // Clean up timer on client disconnect
  req.on('close', () => {
    clearInterval(intervalId);
    res.end();
  });
});

/**
 * Reset all rate limiter metrics in Redis (Admin only).
 */
router.post('/stats/reset', async (req: Request, res: Response): Promise<void> => {
  try {
    await redisStore.resetMetrics();
    
    const instanceId = process.env.INSTANCE_ID || 'localhost';
    console.log(JSON.stringify({
      level: 'info',
      event: 'admin_metrics_reset',
      message: 'Rate limiter statistics have been reset',
      instanceId,
    }));

    res.status(200).json({ success: true, message: 'Metrics reset successfully' });
  } catch (err: any) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'admin_metrics_reset_error',
      message: err.message || String(err),
    }));

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to reset rate limiter statistics.',
    });
  }
});

/**
 * Serve the monitoring dashboard HTML.
 */
router.get('/dashboard', (req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

export default router;
