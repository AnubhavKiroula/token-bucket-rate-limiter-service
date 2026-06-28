import express, { Request, Response } from 'express';
import morgan from 'morgan';
import checkRouter from './routes/check';
import { basicAuth } from './middleware/basicAuth';
import adminRouter from './routes/admin';
import metricsRouter from './routes/metrics';

const app = express();

// Standard middleware to parse JSON request bodies
app.use(express.json());

// Morgan HTTP development request logging middleware
app.use(morgan('dev'));

// Mount Public Check Rate Limit Router:
// Allows clients to check their rate-limiting state or supply overrides.
// Mounted under the '/check' sub-route.
app.use('/check', checkRouter);

// Mount Admin Configurations Router:
// Protected by HTTP Basic Auth middleware.
// Mounted under '/admin' (serving /admin/config, /admin/dashboard, etc.).
app.use('/admin', basicAuth, adminRouter);

// Mount Prometheus Observability Exporter Router:
// Protected by HTTP Basic Auth to prevent unauthorized metric harvesting.
// Mounted under '/metrics'.
app.use('/metrics', basicAuth, metricsRouter);

// Health check endpoint.
// Bypasses all authentication and rate-limiting middleware.
// This prevents false negatives where overloaded backends drop health checks,
// causing Kubernetes/Docker load balancers to prematurely restart healthy containers.
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default app;
