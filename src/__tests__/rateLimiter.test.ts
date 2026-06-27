import request from 'supertest';
import express from 'express';
import { RateLimiter } from '../rateLimiter';
import app from '../app';
import { defaultRateLimiter, rateLimiterMiddleware } from '../middleware/rateLimiterMiddleware';
import { redisStore } from '../store/redisStore';

// Mock Redis Store so that unit and endpoint tests run deterministically and offline
jest.mock('../store/redisStore', () => {
  const mockConfigs = new Map<string, { capacity: number; refillRate: number }>();
  const mockBuckets = new Map<string, { tokens: number; lastRefillTime: number }>();
  
  const mockGlobalStats = { total: 0, allowed: 0, denied: 0 };
  const mockClientTotals = new Map<string, number>();
  const mockClientAllowed = new Map<string, number>();
  const mockClientDenied = new Map<string, number>();

  return {
    redisStore: {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      getClientLimitConfig: jest.fn().mockImplementation(async (key: string) => {
        return mockConfigs.get(key) || null;
      }),
      saveClientLimitConfig: jest.fn().mockImplementation(async (key: string, capacity: number, refillRate: number) => {
        mockConfigs.set(key, { capacity, refillRate });
      }),
      consumeToken: jest.fn().mockImplementation(
        async (key: string, tokensToConsume: number, refillRate: number, capacity: number, now: number) => {
          let bucket = mockBuckets.get(key);
          if (!bucket) {
            bucket = {
              tokens: capacity,
              lastRefillTime: now,
            };
          } else {
            const elapsedTimeMs = now - bucket.lastRefillTime;
            if (elapsedTimeMs > 0) {
              const tokensToAdd = elapsedTimeMs * (refillRate / 1000.0);
              bucket.tokens = Math.min(capacity, bucket.tokens + tokensToAdd);
              bucket.lastRefillTime = now;
            }
          }

          let allowed = false;
          if (bucket.tokens >= tokensToConsume) {
            bucket.tokens -= tokensToConsume;
            allowed = true;
          }

          mockBuckets.set(key, bucket);

          return {
            allowed,
            tokensRemaining: bucket.tokens,
            lastRefillTimeMs: bucket.lastRefillTime,
          };
        }
      ),
      recordDecision: jest.fn().mockImplementation(async (key: string, allowed: boolean) => {
        mockGlobalStats.total += 1;
        if (allowed) {
          mockGlobalStats.allowed += 1;
        } else {
          mockGlobalStats.denied += 1;
        }

        mockClientTotals.set(key, (mockClientTotals.get(key) || 0) + 1);
        if (allowed) {
          mockClientAllowed.set(key, (mockClientAllowed.get(key) || 0) + 1);
        } else {
          mockClientDenied.set(key, (mockClientDenied.get(key) || 0) + 1);
        }
      }),
      getMetrics: jest.fn().mockImplementation(async () => {
        const clients: Record<string, { total: number; allowed: number; denied: number }> = {};
        for (const clientKey of mockClientTotals.keys()) {
          clients[clientKey] = {
            total: mockClientTotals.get(clientKey) || 0,
            allowed: mockClientAllowed.get(clientKey) || 0,
            denied: mockClientDenied.get(clientKey) || 0,
          };
        }
        return {
          total: mockGlobalStats.total,
          allowed: mockGlobalStats.allowed,
          denied: mockGlobalStats.denied,
          clients,
        };
      }),
      clearMocks: () => {
        mockConfigs.clear();
        mockBuckets.clear();
        mockGlobalStats.total = 0;
        mockGlobalStats.allowed = 0;
        mockGlobalStats.denied = 0;
        mockClientTotals.clear();
        mockClientAllowed.clear();
        mockClientDenied.clear();
      },
      flushAll: jest.fn().mockImplementation(async () => {
        mockConfigs.clear();
        mockBuckets.clear();
        mockGlobalStats.total = 0;
        mockGlobalStats.allowed = 0;
        mockGlobalStats.denied = 0;
        mockClientTotals.clear();
        mockClientAllowed.clear();
        mockClientDenied.clear();
      })
    },
  };
});

describe('RateLimiter Unit Tests', () => {
  let limiter: RateLimiter;
  let nowMock: number;

  beforeEach(() => {
    // Reset mocked storage
    (redisStore as any).clearMocks();
    nowMock = 1000000000; // Fixed start time
    jest.spyOn(Date, 'now').mockImplementation(() => nowMock);
    limiter = new RateLimiter(2, 5);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should initialize at full capacity and consume tokens', async () => {
    const result1 = await limiter.consume('client1', 1);
    expect(result1.allowed).toBe(true);
    expect(result1.tokensRemaining).toBe(4);
    expect(result1.capacity).toBe(5);

    const result2 = await limiter.consume('client1', 3);
    expect(result2.allowed).toBe(true);
    expect(result2.tokensRemaining).toBe(1);
  });

  it('should deny consumption once bucket is exhausted', async () => {
    const result1 = await limiter.consume('client1', 5);
    expect(result1.allowed).toBe(true);
    expect(result1.tokensRemaining).toBe(0);

    const result2 = await limiter.consume('client1', 1);
    expect(result2.allowed).toBe(false);
    expect(result2.tokensRemaining).toBe(0);
  });

  it('should refill tokens smoothly over elapsed time', async () => {
    await limiter.consume('client1', 5);

    // Advance mock time by 1 second (refill 2 tokens)
    nowMock += 1000;

    const result = await limiter.consume('client1', 1);
    expect(result.allowed).toBe(true);
    expect(result.tokensRemaining).toBe(1);
  });

  it('should not exceed burst capacity limit during refill', async () => {
    await limiter.consume('client1', 1); // 4 remaining
    
    // Advance mock time by 10 seconds (cap at capacity 5)
    nowMock += 10000;

    const result = await limiter.consume('client1', 1);
    expect(result.allowed).toBe(true);
    expect(result.tokensRemaining).toBe(4);
  });

  it('should respect custom capacity and refillRate overrides', async () => {
    const result = await limiter.consume('client1', 1, 5, 10);
    expect(result.allowed).toBe(true);
    expect(result.capacity).toBe(10);
    expect(result.refillRate).toBe(5);
    expect(result.tokensRemaining).toBe(9);
  });
});

describe('GET /check Integration Tests', () => {
  let nowMock: number;

  beforeEach(() => {
    (redisStore as any).clearMocks();
    nowMock = 1000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return 400 Bad Request if client key is missing', async () => {
    const response = await request(app)
      .get('/check')
      .expect(400);

    expect(response.body).toHaveProperty('error', 'Bad Request');
  });

  it('should return ALLOW with headers when under limit', async () => {
    const response = await request(app)
      .get('/check?key=integration_test')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        decision: 'ALLOW',
        key: 'integration_test',
        capacity: 10,
        refillRate: 10,
      })
    );

    expect(response.headers).toHaveProperty('x-ratelimit-limit', '10');
    expect(response.headers).toHaveProperty('x-ratelimit-remaining');
  });

  it('should return DENY when request rate is exceeded', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).get('/check?key=limit_test');
    }

    const response = await request(app)
      .get('/check?key=limit_test')
      .expect(200);

    expect(response.body.decision).toBe('DENY');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('should support override configurations via query parameters', async () => {
    const response1 = await request(app).get('/check?key=override_test&capacity=2');
    expect(response1.headers['x-ratelimit-limit']).toBe('2');
    expect(response1.body.tokensRemaining).toBe(1);

    const response2 = await request(app).get('/check?key=override_test&capacity=2');
    expect(response2.body.tokensRemaining).toBe(0);

    const response3 = await request(app).get('/check?key=override_test&capacity=2');
    expect(response3.body.decision).toBe('DENY');
  });
});

describe('rateLimiterMiddleware Integration Tests', () => {
  let testApp: express.Application;
  let testLimiter: RateLimiter;
  let nowMock: number;

  beforeEach(() => {
    (redisStore as any).clearMocks();
    nowMock = 1000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMock);

    // Limit of 2 requests, capacity 2
    testLimiter = new RateLimiter(10, 2);
    testApp = express();
    testApp.use(rateLimiterMiddleware(testLimiter));
    testApp.get('/test-route', (req, res) => {
      res.status(200).send('success');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should allow requests below limit and set headers', async () => {
    const response = await request(testApp)
      .get('/test-route?key=mw_client')
      .expect(200);

    expect(response.text).toBe('success');
    expect(response.headers['x-ratelimit-limit']).toBe('2');
    expect(response.headers['x-ratelimit-remaining']).toBe('1');
    expect(response.headers['x-ratelimit-reset']).toBe('1000001'); // 1s wait
  });

  it('should return 429 with JSON body and headers when rate limit is exceeded', async () => {
    // Request 1: consumes 1 token
    await request(testApp).get('/test-route?key=mw_client').expect(200);
    // Request 2: consumes 2nd token
    await request(testApp).get('/test-route?key=mw_client').expect(200);
    
    // Request 3: gets blocked with 429
    const response = await request(testApp)
      .get('/test-route?key=mw_client')
      .expect(429);

    expect(response.body).toEqual({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      key: 'mw_client',
      tokensRemaining: 0,
      capacity: 2,
      refillRate: 10,
      resetTime: 1000001,
    });
    expect(response.headers['x-ratelimit-limit']).toBe('2');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
  });
});
