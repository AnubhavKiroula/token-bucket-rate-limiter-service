import { Router, Request, Response } from 'express';
import { redisStore } from '../store/redisStore';

const router = Router();

/**
 * Expose metrics in standard Prometheus plain text format.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await redisStore.getMetrics();
    let prometheusText = '';

    // Global Metrics
    prometheusText += '# HELP rate_limiter_requests_total The total number of rate limiter requests checked.\n';
    prometheusText += '# TYPE rate_limiter_requests_total counter\n';
    prometheusText += `rate_limiter_requests_total ${metrics.total}\n\n`;

    prometheusText += '# HELP rate_limiter_requests_allowed_total The total number of allowed rate limiter requests.\n';
    prometheusText += '# TYPE rate_limiter_requests_allowed_total counter\n';
    prometheusText += `rate_limiter_requests_allowed_total ${metrics.allowed}\n\n`;

    prometheusText += '# HELP rate_limiter_requests_denied_total The total number of denied rate limiter requests.\n';
    prometheusText += '# TYPE rate_limiter_requests_denied_total counter\n';
    prometheusText += `rate_limiter_requests_denied_total ${metrics.denied}\n\n`;

    // Client-Specific Metrics
    prometheusText += '# HELP rate_limiter_client_requests_total The total requests per client.\n';
    prometheusText += '# TYPE rate_limiter_client_requests_total counter\n';
    for (const clientKey of Object.keys(metrics.clients)) {
      const client = metrics.clients[clientKey];
      prometheusText += `rate_limiter_client_requests_total{client="${clientKey}"} ${client.total}\n`;
    }
    prometheusText += '\n';

    prometheusText += '# HELP rate_limiter_client_requests_allowed_total The total allowed requests per client.\n';
    prometheusText += '# TYPE rate_limiter_client_requests_allowed_total counter\n';
    for (const clientKey of Object.keys(metrics.clients)) {
      const client = metrics.clients[clientKey];
      prometheusText += `rate_limiter_client_requests_allowed_total{client="${clientKey}"} ${client.allowed}\n`;
    }
    prometheusText += '\n';

    prometheusText += '# HELP rate_limiter_client_requests_denied_total The total denied requests per client.\n';
    prometheusText += '# TYPE rate_limiter_client_requests_denied_total counter\n';
    for (const clientKey of Object.keys(metrics.clients)) {
      const client = metrics.clients[clientKey];
      prometheusText += `rate_limiter_client_requests_denied_total{client="${clientKey}"} ${client.denied}\n`;
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(prometheusText);
  } catch (err: any) {
    res.status(500).send('# ERROR: Failed to gather rate-limiter metrics');
  }
});

export default router;
