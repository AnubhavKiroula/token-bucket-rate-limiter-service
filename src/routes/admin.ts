import { Router, Request, Response } from 'express';
import path from 'path';
import { redisStore } from '../store/redisStore';

const router = Router();

/**
 * Configure rate limit overrides for a specific client key.
 * Saves the limits in the persistent Redis cache (redisStore.ts).
 * Any subsequent check for this key resolves to these custom limits.
 * 
 * Connection to other files:
 * - Protected by HTTP Basic Auth in `src/app.ts`.
 * - Persists overrides in `redisStore.ts` under keys `rate-limit-config:<clientKey>`.
 */
router.post('/config', async (req: Request, res: Response): Promise<void> => {
  const { key, capacity, refillRate } = req.body;

  // Validate presence of target client identifier
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'Bad Request', message: 'Missing or invalid "key" field. Must be a string.' });
    return;
  }

  const parsedCapacity = parseInt(String(capacity), 10);
  const parsedRefillRate = parseFloat(String(refillRate));

  // Validate limits are positive numbers
  if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
    res.status(400).json({ error: 'Bad Request', message: '"capacity" must be a positive integer.' });
    return;
  }

  if (isNaN(parsedRefillRate) || parsedRefillRate <= 0) {
    res.status(400).json({ error: 'Bad Request', message: '"refillRate" must be a positive number.' });
    return;
  }

  try {
    // Persist configuration in Redis
    await redisStore.saveClientLimitConfig(key, parsedCapacity, parsedRefillRate);

    const instanceId = process.env.INSTANCE_ID || 'localhost';

    // Structured JSON log auditing administrative configuration modifications
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
 * Fetch current aggregated metrics from Redis.
 * Returns global counts and a client leaderboard dictionary.
 * 
 * Connection to other files:
 * - Reads values using `redisStore.getMetrics()`.
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
 * Keeps a persistent HTTP connection open, polling Redis every second and pushing updates
 * as structured text chunks to the front-end observability dashboard.
 * 
 * Connection to other files:
 * - Stream consumed by `dashboard.html` SSE EventSource.
 */
router.get('/stats/live', (req: Request, res: Response): void => {
  // Establish persistent SSE connection headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendUpdate = async () => {
    try {
      const metrics = await redisStore.getMetrics();
      res.write(`data: ${JSON.stringify(metrics)}\n\n`);
    } catch (err) {
      // Suppress metrics gathering errors in live stream to avoid log flooding
    }
  };

  // Push immediate initial state on connection
  sendUpdate();

  // Poll Redis and push metrics every 1000ms
  const intervalId = setInterval(sendUpdate, 1000);

  // Clean up timer on client disconnect to prevent memory leaks
  req.on('close', () => {
    clearInterval(intervalId);
    res.end();
  });
});

/**
 * Reset all rate limiter metrics in Redis (Admin only).
 * Clears global and client telemetry hashes.
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
 * Renders the Chart.js line charts and clients leaderboard.
 */
router.get('/dashboard', (req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

export default router;
