import dotenv from 'dotenv';
import app from './app';
import { redisStore } from './store/redisStore';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const instanceId = process.env.INSTANCE_ID || 'localhost';

async function startServer() {
  try {
    // 1. Establish connection to Redis persistence layer
    await redisStore.connect();

    // 2. Start Express listener
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
    console.error(JSON.stringify({
      level: 'error',
      event: 'server_start_error',
      message: `Failed to start server: ${err.message || String(err)}`,
      instanceId,
    }));
    process.exit(1);
  }
}

startServer();
