import dotenv from 'dotenv';
import app from './app';

// Load environment variables from a .env file if present
dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[Server] Token Bucket Rate Limiter Service listening on port ${PORT}`);
});
