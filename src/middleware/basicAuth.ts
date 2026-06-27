import { Request, Response, NextFunction } from 'express';

/**
 * Basic Authentication middleware to protect sensitive endpoints.
 * Matches incoming credentials against ADMIN_USERNAME and ADMIN_PASSWORD env variables.
 */
export const basicAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Please provide credentials via Basic Auth.',
    });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'basic') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authorization format. Expected Basic Authentication.',
    });
    return;
  }

  const credentials = Buffer.from(parts[1], 'base64').toString('ascii').split(':');
  if (credentials.length !== 2) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid credentials format.',
    });
    return;
  }

  const [username, password] = credentials;

  // Retrieve authorized credentials from environment (with fallback defaults)
  const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || 'secret123';

  if (username === expectedUsername && password === expectedPassword) {
    next();
  } else {
    // Audit log failed attempt in JSON structured format
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'admin_auth_failed',
      message: `Failed admin login attempt for username "${username}"`,
      ip: req.ip,
    }));

    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid username or password.',
    });
  }
};
