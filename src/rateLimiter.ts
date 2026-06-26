export interface ConsumeResult {
  allowed: boolean;
  tokensRemaining: number;
  capacity: number;
  refillRate: number; // per second
  resetTimeMs: number; // Epoch timestamp in ms when bucket is fully refilled
}

export interface BucketState {
  tokens: number;
  lastRefillTime: number; // Epoch timestamp in ms
}

export class RateLimiter {
  private defaultRefillRate: number; // tokens per second
  private defaultCapacity: number;   // max tokens
  private buckets: Map<string, BucketState>;

  constructor(defaultRefillRate: number, defaultCapacity: number) {
    this.defaultRefillRate = defaultRefillRate;
    this.defaultCapacity = defaultCapacity;
    this.buckets = new Map<string, BucketState>();
  }

  /**
   * Consume tokens from a client's bucket.
   * 
   * @param key Unique key representing the client (e.g., IP address or API key)
   * @param tokensToConsume Number of tokens to consume (default: 1)
   * @param customRefillRate Optional custom refill rate override (tokens/sec) for this client
   * @param customCapacity Optional custom capacity override (burst size) for this client
   */
  public consume(
    key: string,
    tokensToConsume: number = 1,
    customRefillRate?: number,
    customCapacity?: number
  ): ConsumeResult {
    const now = Date.now();
    const refillRate = customRefillRate !== undefined ? customRefillRate : this.defaultRefillRate;
    const capacity = customCapacity !== undefined ? customCapacity : this.defaultCapacity;

    // Fetch existing state or initialize a new bucket at full capacity
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: capacity,
        lastRefillTime: now,
      };
    } else {
      // Calculate token replenishment based on time elapsed
      const elapsedTimeMs = now - bucket.lastRefillTime;
      const tokensToAdd = elapsedTimeMs * (refillRate / 1000);
      bucket.tokens = Math.min(capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefillTime = now;
    }

    let allowed = false;
    if (bucket.tokens >= tokensToConsume) {
      bucket.tokens -= tokensToConsume;
      allowed = true;
    }

    // Save updated bucket state
    this.buckets.set(key, bucket);

    // Calculate reset time (when the bucket will be completely full again)
    const tokensNeeded = capacity - bucket.tokens;
    const timeNeededMs = refillRate > 0 ? (tokensNeeded / (refillRate / 1000)) : 0;
    const resetTimeMs = Math.ceil(now + timeNeededMs);

    return {
      allowed,
      tokensRemaining: bucket.tokens,
      capacity,
      refillRate,
      resetTimeMs,
    };
  }

  /**
   * Helper to inspect the current raw state of a bucket (useful for testing)
   */
  public getBucket(key: string): BucketState | undefined {
    return this.buckets.get(key);
  }

  /**
   * Helper to clear limiter state
   */
  public clear(): void {
    this.buckets.clear();
  }
}
