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

import metricsRouter from './routes/metrics';

// Mount Prometheus metrics (protected by HTTP Basic Auth)
app.use('/metrics', basicAuth, metricsRouter);

// Health check endpoint
// Note: Rate limiting is explicitly bypassed for health checks to prevent false negatives in monitoring systems
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default app;
