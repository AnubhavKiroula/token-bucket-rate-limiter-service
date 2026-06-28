import dotenv from 'dotenv';
import app from './app';
import { redisStore } from './store/redisStore';

// Load environment variables from .env file into process.env
dotenv.config();

const PORT = process.env.PORT || 3000;
const instanceId = process.env.INSTANCE_ID || 'localhost';

/**
 * Orchestrates application startup operations.
 * Connects to the Redis persistence layer (redisStore.ts), starts the Express listener,
 * and handles startup failure modes by exiting the process.
 */
async function startServer() {
  try {
    // Step 1: Establish connection to Redis persistence layer.
    // This is a blocking call: we do not accept HTTP traffic until the Redis client
    // is successfully initialized to prevent startup race conditions.
    await redisStore.connect();

    // Step 2: Start the Express HTTP listener
    app.listen(PORT, () => {
      console.log(JSON.stringify({
        level: 'info',
        event: 'server_start',
        message: `[Server] Token Bucket Rate Limiter Service listening on port ${PORT}`,
        port: PORT,
        instanceId,
      }));
    });
  } catch (err: any) {
    // Audit startup failure
    console.error(JSON.stringify({
      level: 'error',
      event: 'server_start_error',
      message: `Failed to start server: ${err.message || String(err)}`,
      instanceId,
    }));
    // Exit process with failure code
    process.exit(1);
  }
}

// Invoke server bootstrap
startServer();
