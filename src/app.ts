import express, { Request, Response } from 'express';
import morgan from 'morgan';

const app = express();

// Standard middleware to parse JSON bodies
app.use(express.json());

// Observability/Logging middleware
app.use(morgan('dev'));

// Health check endpoint
// Note: Rate limiting is explicitly bypassed for health checks to prevent false negatives in monitoring systems
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default app;
