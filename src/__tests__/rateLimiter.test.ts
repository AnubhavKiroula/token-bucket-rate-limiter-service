import request from 'supertest';
import { RateLimiter } from '../rateLimiter';
import app from '../app';
import { defaultRateLimiter } from '../middleware/rateLimiterMiddleware';

describe('RateLimiter Unit Tests', () => {
  let limiter: RateLimiter;
  let nowMock: number;

  beforeEach(() => {
    nowMock = 1000000000; // Fixed start time (Unix epoch ms)
    jest.spyOn(Date, 'now').mockImplementation(() => nowMock);
    // Limiter: 2 tokens per second, capacity (burst) of 5
    limiter = new RateLimiter(2, 5);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should initialize at full capacity and consume tokens', () => {
    const result1 = limiter.consume('client1', 1);
    expect(result1.allowed).toBe(true);
    expect(result1.tokensRemaining).toBe(4);
    expect(result1.capacity).toBe(5);

    const result2 = limiter.consume('client1', 3);
    expect(result2.allowed).toBe(true);
    expect(result2.tokensRemaining).toBe(1);
  });

  it('should deny consumption once bucket is exhausted', () => {
    // Consume all 5 tokens
    const result1 = limiter.consume('client1', 5);
    expect(result1.allowed).toBe(true);
    expect(result1.tokensRemaining).toBe(0);

    // Consume another one
    const result2 = limiter.consume('client1', 1);
    expect(result2.allowed).toBe(false);
    expect(result2.tokensRemaining).toBe(0);
  });

  it('should refill tokens smoothly over elapsed time', () => {
    // Consume 5 tokens
    limiter.consume('client1', 5);

    // Advance mock time by 1 second (1000ms).
    // With refillRate = 2/sec, we expect 2 tokens to replenish.
    nowMock += 1000;

    const result = limiter.consume('client1', 1);
    expect(result.allowed).toBe(true);
    // Initial: 5 -> after consume: 0 -> after 1s refill: 2 -> after consume 1: 1 token remaining
    expect(result.tokensRemaining).toBe(1);
  });

  it('should not exceed burst capacity limit during refill', () => {
    limiter.consume('client1', 1); // 4 remaining
    
    // Advance mock time by 10 seconds (should refill 20 tokens, but capacity is capped at 5)
    nowMock += 10000;

    const result = limiter.consume('client1', 1);
    expect(result.allowed).toBe(true);
    expect(result.tokensRemaining).toBe(4); // Capped at 5, consumed 1 -> 4
  });

  it('should respect custom capacity and refillRate overrides', () => {
    // Consume with custom capacity 10 and refill rate 5
    const result = limiter.consume('client1', 1, 5, 10);
    expect(result.allowed).toBe(true);
    expect(result.capacity).toBe(10);
    expect(result.refillRate).toBe(5);
    expect(result.tokensRemaining).toBe(9); // Initial 10 - 1 = 9
  });
});

describe('GET /check Integration Tests', () => {
  let nowMock: number;

  beforeEach(() => {
    nowMock = 1000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMock);
    defaultRateLimiter.clear();
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
    // Default rate limit capacity is 10. Perform 10 requests to empty bucket.
    for (let i = 0; i < 10; i++) {
      await request(app).get('/check?key=limit_test');
    }

    // The 11th request must be denied
    const response = await request(app)
      .get('/check?key=limit_test')
      .expect(200);

    expect(response.body.decision).toBe('DENY');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('should support override configurations via query parameters', async () => {
    // Custom capacity of 2
    const response1 = await request(app).get('/check?key=override_test&capacity=2');
    expect(response1.headers['x-ratelimit-limit']).toBe('2');
    expect(response1.body.tokensRemaining).toBe(1);

    const response2 = await request(app).get('/check?key=override_test&capacity=2');
    expect(response2.body.tokensRemaining).toBe(0);

    const response3 = await request(app).get('/check?key=override_test&capacity=2');
    expect(response3.body.decision).toBe('DENY');
  });
});
