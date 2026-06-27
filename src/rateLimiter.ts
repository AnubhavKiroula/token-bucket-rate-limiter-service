import { redisStore } from './store/redisStore';

export interface ConsumeResult {
  allowed: boolean;
  tokensRemaining: number;
  capacity: number;
  refillRate: number; // per second
  resetTimeMs: number; // Epoch timestamp in ms when bucket is fully refilled
}

export class RateLimiter {
  private defaultRefillRate: number; // tokens per second
  private defaultCapacity: number;   // max tokens

  constructor(defaultRefillRate: number, defaultCapacity: number) {
    this.defaultRefillRate = defaultRefillRate;
    this.defaultCapacity = defaultCapacity;
  }

  /**
   * Consume tokens from a client's bucket asynchronously using Redis.
   * 
   * @param key Unique key representing the client (e.g., IP address or API key)
   * @param tokensToConsume Number of tokens to consume (default: 1)
   * @param customRefillRate Optional custom refill rate override (tokens/sec) for this client
   * @param customCapacity Optional custom capacity override (burst size) for this client
   */
  public async consume(
    key: string,
    tokensToConsume: number = 1,
    customRefillRate?: number,
    customCapacity?: number
  ): Promise<ConsumeResult> {
    let refillRate = this.defaultRefillRate;
    let capacity = this.defaultCapacity;

    // Resolve rate-limit config in precedence:
    // 1. Direct custom parameters passed to consume()
    // 2. Persistent configuration stored in Redis for this client
    // 3. Fallback to global defaults configured in the constructor
    if (customRefillRate !== undefined || customCapacity !== undefined) {
      refillRate = customRefillRate !== undefined ? customRefillRate : this.defaultRefillRate;
      capacity = customCapacity !== undefined ? customCapacity : this.defaultCapacity;
    } else {
      const dbConfig = await redisStore.getClientLimitConfig(key);
      if (dbConfig) {
        refillRate = dbConfig.refillRate;
        capacity = dbConfig.capacity;
      }
    }

    const now = Date.now();

    // Call atomic Redis Lua operation
    const result = await redisStore.consumeToken(
      key,
      tokensToConsume,
      refillRate,
      capacity,
      now
    );

    // Calculate reset time (when the bucket will be completely full again)
    const tokensNeeded = capacity - result.tokensRemaining;
    const timeNeededMs = refillRate > 0 ? (tokensNeeded / (refillRate / 1000)) : 0;
    const resetTimeMs = Math.ceil(now + timeNeededMs);

    return {
      allowed: result.allowed,
      tokensRemaining: result.tokensRemaining,
      capacity,
      refillRate,
      resetTimeMs,
    };
  }
}
