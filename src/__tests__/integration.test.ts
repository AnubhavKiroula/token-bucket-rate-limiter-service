import { RateLimiter } from '../rateLimiter';
import { redisStore } from '../store/redisStore';

describe('Redis E2E Integration Tests', () => {
  let isRedisAvailable = false;
  let limiter1: RateLimiter;
  let limiter2: RateLimiter;

  beforeAll(async () => {
    // Attempt connection to verify if a Redis server is reachable locally
    try {
      // Shorten timeout to detect if Redis is absent quickly
      process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
      await redisStore.connect();
      await redisStore.flushAll(); // Clean state
      isRedisAvailable = true;

      // Instantiate two distinct rate limiter instances sharing the same Redis client
      limiter1 = new RateLimiter(10, 10); // Node 1
      limiter2 = new RateLimiter(10, 10); // Node 2
    } catch (err) {
      console.warn('[Integration Test] Redis server not reachable at localhost:6379. Skipping Redis E2E integration tests.');
    }
  });

  afterAll(async () => {
    if (isRedisAvailable) {
      try {
        await redisStore.disconnect();
      } catch (err) {
        // Suppress teardown warnings
      }
    }
  });

  beforeEach(async () => {
    if (isRedisAvailable) {
      await redisStore.flushAll();
    }
  });

  it('should skip tests dynamically if Redis is not running', () => {
    if (!isRedisAvailable) {
      console.log('Skipping E2E tests: Redis is not available');
      return;
    }
    expect(isRedisAvailable).toBe(true);
  });

  it('should persist rate limit state and share it across multiple RateLimiter instances', async () => {
    if (!isRedisAvailable) return;

    const key = 'shared-client-key';

    // Instance 1 consumes 3 tokens
    const r1 = await limiter1.consume(key, 3);
    expect(r1.allowed).toBe(true);
    expect(r1.tokensRemaining).toBe(7);

    // Instance 2 consumes 2 tokens from the same key
    const r2 = await limiter2.consume(key, 2);
    expect(r2.allowed).toBe(true);
    // State is synchronized! Tokens remaining should be 5
    expect(r2.tokensRemaining).toBe(5);

    // Instance 1 consumes remaining 5 tokens
    const r3 = await limiter1.consume(key, 5);
    expect(r3.allowed).toBe(true);
    expect(r3.tokensRemaining).toBe(0);

    // Instance 2 attempts to consume 1 token and gets denied
    const r4 = await limiter2.consume(key, 1);
    expect(r4.allowed).toBe(false);
    expect(r4.tokensRemaining).toBe(0);
  });

  it('should dynamically load and respect custom config overrides saved via Admin', async () => {
    if (!isRedisAvailable) return;

    const key = 'custom-admin-client';

    // Save custom configuration in Redis (capacity = 4, refillRate = 1)
    await redisStore.saveClientLimitConfig(key, 4, 1);

    // Instance 1 consumes. It should load capacity of 4
    const r1 = await limiter1.consume(key, 1);
    expect(r1.allowed).toBe(true);
    expect(r1.capacity).toBe(4);
    expect(r1.refillRate).toBe(1);
    expect(r1.tokensRemaining).toBe(3);

    // Exhaust the custom capacity
    await limiter1.consume(key, 3);

    // The 5th token consume should be blocked (capacity is 4)
    const r2 = await limiter2.consume(key, 1);
    expect(r2.allowed).toBe(false);
  });
});
