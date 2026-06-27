import express, { Request, Response } from 'express';
import morgan from 'morgan';
import checkRouter from './routes/check';

const app = express();

// Standard middleware to parse JSON bodies
app.use(express.json());

// Observability/Logging middleware
app.use(morgan('dev'));

// Mount Check Rate Limit Route
app.use('/check', checkRouter);

// Import admin security and routes
import { basicAuth } from './middleware/basicAuth';
import adminRouter from './routes/admin';

// Mount Admin Configurations (protected by HTTP Basic Auth)
app.use('/admin', basicAuth, adminRouter);

import { redisStore } from './store/redisStore';

// Prometheus metrics endpoint (publicly scrapeable)
app.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await redisStore.getMetrics();
    let prometheusText = '';

    // Global Metrics
    prometheusText += '# HELP rate_limiter_requests_total The total number of rate limiter requests checked.\n';
    prometheusText += '# TYPE rate_limiter_requests_total counter\n';
    prometheusText += `rate_limiter_requests_total ${metrics.total}\n\n`;

    prometheusText += '# HELP rate_limiter_requests_allowed The total number of allowed rate limiter requests.\n';
    prometheusText += '# TYPE rate_limiter_requests_allowed counter\n';
    prometheusText += `rate_limiter_requests_allowed ${metrics.allowed}\n\n`;

    prometheusText += '# HELP rate_limiter_requests_denied The total number of denied rate limiter requests.\n';
    prometheusText += '# TYPE rate_limiter_requests_denied counter\n';
    prometheusText += `rate_limiter_requests_denied ${metrics.denied}\n\n`;

    // Client-Specific Metrics
    prometheusText += '# HELP rate_limiter_client_requests_total The total requests per client.\n';
    prometheusText += '# TYPE rate_limiter_client_requests_total counter\n';
    for (const clientKey of Object.keys(metrics.clients)) {
      const client = metrics.clients[clientKey];
      prometheusText += `rate_limiter_client_requests_total{client="${clientKey}"} ${client.total}\n`;
    }
    prometheusText += '\n';

    prometheusText += '# HELP rate_limiter_client_requests_allowed The total allowed requests per client.\n';
    prometheusText += '# TYPE rate_limiter_client_requests_allowed counter\n';
    for (const clientKey of Object.keys(metrics.clients)) {
      const client = metrics.clients[clientKey];
      prometheusText += `rate_limiter_client_requests_allowed{client="${clientKey}"} ${client.allowed}\n`;
    }
    prometheusText += '\n';

    prometheusText += '# HELP rate_limiter_client_requests_denied The total denied requests per client.\n';
    prometheusText += '# TYPE rate_limiter_client_requests_denied counter\n';
    for (const clientKey of Object.keys(metrics.clients)) {
      const client = metrics.clients[clientKey];
      prometheusText += `rate_limiter_client_requests_denied{client="${clientKey}"} ${client.denied}\n`;
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(prometheusText);
  } catch (err: any) {
    res.status(500).send('# ERROR: Failed to gather rate-limiter metrics');
  }
});

// Health check endpoint
// Note: Rate limiting is explicitly bypassed for health checks to prevent false negatives in monitoring systems
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default app;
