import { redisStore } from './store/redisStore';

/**
 * Interface representing the structured outcome of a token consumption attempt.
 */
export interface ConsumeResult {
  /** True if the request is permitted; false otherwise */
  allowed: boolean;
  /** Decimal count of remaining tokens in the bucket after calculation */
  tokensRemaining: number;
  /** Maximum capacity (burst size) of the bucket resolved for this client */
  capacity: number;
  /** Token replenishment rate (tokens/sec) resolved for this client */
  refillRate: number;
  /** Epoch timestamp in milliseconds indicating when the bucket will be fully refilled */
  resetTimeMs: number;
}

/**
 * RateLimiter coordinates the Token Bucket rate-limiting algorithm.
 * It integrates with the Redis persistent layer (redisStore.ts) using atomic Lua scripts
 * to coordinate token consumption safely in a distributed, multi-instance environment.
 */
export class RateLimiter {
  /** Fallback token replenishment rate (tokens per second) */
  private defaultRefillRate: number;
  /** Fallback maximum token capacity (burst capacity) */
  private defaultCapacity: number;

  /**
   * Initializes the RateLimiter instance with default rate limit configurations.
   * 
   * @param defaultRefillRate The default number of tokens replenished per second
   * @param defaultCapacity The default maximum capacity/burst size
   */
  constructor(defaultRefillRate: number, defaultCapacity: number) {
    this.defaultRefillRate = defaultRefillRate;
    this.defaultCapacity = defaultCapacity;
  }

  /**
   * Evaluates if a request from a specific client key is permitted.
   * Resolves the rate-limiting parameters (refillRate, capacity) in precedence order,
   * invokes the atomic Redis Lua script, records the decision for analytics,
   * and calculates when the client's bucket will fully replenish.
   * 
   * Precedence Order for Rate Limits:
   * 1. Dynamic arguments passed directly to this consume() function (e.g., query params).
   * 2. Persistent overrides configured in Redis via the admin configuration router (admin.ts).
   * 3. Fallback global settings configured in this class's constructor (app.ts defaults).
   * 
   * @param key Unique key representing the client identifier (e.g., API key, user ID, IP address)
   * @param tokensToConsume The number of tokens needed for this request (default: 1)
   * @param customRefillRate Optional dynamic refill rate override (tokens/sec) for this request
   * @param customCapacity Optional dynamic capacity override (burst size) for this request
   * @returns A promise resolving to the detailed ConsumeResult object
   */
  public async consume(
    key: string,
    tokensToConsume: number = 1,
    customRefillRate?: number,
    customCapacity?: number
  ): Promise<ConsumeResult> {
    let refillRate = this.defaultRefillRate;
    let capacity = this.defaultCapacity;

    // Phase 1: Precedence Resolution
    if (customRefillRate !== undefined || customCapacity !== undefined) {
      // Priority 1: Use direct query/header parameter overrides if supplied
      refillRate = customRefillRate !== undefined ? customRefillRate : this.defaultRefillRate;
      capacity = customCapacity !== undefined ? customCapacity : this.defaultCapacity;
    } else {
      // Priority 2: Query the Redis cache for persistent client configurations saved via /admin/config
      const dbConfig = await redisStore.getClientLimitConfig(key);
      if (dbConfig) {
        refillRate = dbConfig.refillRate;
        capacity = dbConfig.capacity;
      }
      // Priority 3: Fallback defaults resolved at variable declaration above
    }

    const now = Date.now();

    // Phase 2: Execute Atomic Redis Lua Transaction
    // Delegates evaluation to Redis (redisStore.ts) to execute refilling and consumption atomically,
    // protecting the system from read-modify-write race conditions in multi-instance environments.
    const result = await redisStore.consumeToken(
      key,
      tokensToConsume,
      refillRate,
      capacity,
      now
    );

    // Phase 3: Calculate Reset Time
    // resetTime represents the point in time (Epoch ms) when the bucket will return to maximum capacity.
    // Time to refill = (Tokens to Refill) / (Refill Rate per Millisecond)
    const tokensNeeded = capacity - result.tokensRemaining;
    const timeNeededMs = refillRate > 0 ? (tokensNeeded / (refillRate / 1000)) : 0;
    const resetTimeMs = Math.ceil(now + timeNeededMs);

    // Phase 4: Observability and Telemetry recording
    // Records the decision asynchronously in Redis metrics hashes to feed the SSE live dashboard.
    await redisStore.recordDecision(key, result.allowed);

    return {
      allowed: result.allowed,
      tokensRemaining: result.tokensRemaining,
      capacity,
      refillRate,
      resetTimeMs,
    };
  }
}
