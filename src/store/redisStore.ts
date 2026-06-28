import { createClient, RedisClientType } from 'redis';

/**
 * Lua script implementing atomic token bucket refills and consumption checks.
 * By running this script entirely on the Redis engine, we ensure transaction-like atomicity,
 * preventing race conditions in distributed multi-instance architectures where different
 * application instances try to update the token bucket simultaneously.
 * 
 * Logic details:
 * 1. Fetch current 'tokens' and 'lastRefillTime' values from the client's Redis hash.
 * 2. If missing, initialize to full capacity with the current timestamp.
 * 3. If present, replenish tokens proportionally to the elapsed time (ms) since the last check.
 * 4. Deduct requested tokens if the bucket has enough capacity.
 * 5. Update and persist the hash state, then apply a TTL expiry to clean up inactive keys.
 */
const LUA_RATE_LIMITER = `
  local key = KEYS[1]
  local tokensToConsume = tonumber(ARGV[1])
  local refillRate = tonumber(ARGV[2])
  local capacity = tonumber(ARGV[3])
  local now = tonumber(ARGV[4])

  -- Fetch current state from hash
  local data = redis.call('HMGET', key, 'tokens', 'lastRefillTime')
  local tokens = tonumber(data[1])
  local lastRefillTime = tonumber(data[2])

  if not tokens or not lastRefillTime then
    -- Initialize to full capacity if bucket does not exist
    tokens = capacity
    lastRefillTime = now
  else
    -- Replenish tokens based on elapsed time (in milliseconds)
    local elapsedTimeMs = now - lastRefillTime
    if elapsedTimeMs > 0 then
      local tokensToAdd = elapsedTimeMs * (refillRate / 1000.0)
      tokens = math.min(capacity, tokens + tokensToAdd)
      lastRefillTime = now
    end
  end

  local allowed = 0
  if tokens >= tokensToConsume then
    tokens = tokens - tokensToConsume
    allowed = 1
  end

  -- Persist updated bucket state
  redis.call('HMSET', key, 'tokens', tostring(tokens), 'lastRefillTime', tostring(lastRefillTime))

  -- Expire bucket state after a duration of inactivity (refill time + 1 hour buffer)
  -- This frees memory from inactive client keys without losing configurations.
  local fillTimeSec = math.ceil((capacity / (refillRate / 1000.0)) / 1000.0)
  local ttl = fillTimeSec + 3600
  redis.call('EXPIRE', key, ttl)

  return { allowed, tostring(tokens), tostring(lastRefillTime) }
`;

/**
 * Result structure returned after evaluating token consumption against Redis.
 */
export interface RedisConsumeResult {
  /** True if the request is permitted */
  allowed: boolean;
  /** Decimal value representing remaining tokens in the bucket */
  tokensRemaining: number;
  /** Timestamp in milliseconds of the last refill calculation */
  lastRefillTimeMs: number;
}

/**
 * RedisStore coordinates low-level communication with the Redis server.
 * It manages connection lifecycles, script executions, and metric increments.
 * 
 * Connection to other files:
 * - Instantiated once and exported as `redisStore`.
 * - Used by `src/rateLimiter.ts` to perform core token checks.
 * - Used by `src/routes/admin.ts` to save and read configurations and gather telemetry stats.
 * - Used by `src/routes/metrics.ts` to retrieve and format Prometheus scraping responses.
 */
export class RedisStore {
  /** Underlying raw node-redis client */
  private client: RedisClientType;
  /** Flag representing active connection state */
  private isConnected: boolean = false;

  /**
   * Initializes the Redis connection client and binds status listeners.
   */
  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = createClient({
      url: redisUrl,
      socket: {
        // In test environments, fail connection immediately without retrying to avoid hanging Jest.
        // In production, retry with a progressive backoff capped at 3 seconds.
        reconnectStrategy: process.env.NODE_ENV === 'test' 
          ? false 
          : (retries) => Math.min(retries * 100, 3000)
      }
    });

    // Logging listeners to track Redis client state
    this.client.on('connect', () => {
      console.log(JSON.stringify({ level: 'info', event: 'redis_connecting', message: 'Connecting to Redis server...' }));
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      console.log(JSON.stringify({ level: 'info', event: 'redis_ready', message: 'Redis client connected and ready' }));
    });

    this.client.on('error', (err) => {
      console.error(JSON.stringify({ level: 'error', event: 'redis_error', message: err.message || String(err) }));
    });

    this.client.on('end', () => {
      this.isConnected = false;
      console.log(JSON.stringify({ level: 'info', event: 'redis_disconnected', message: 'Redis client connection closed' }));
    });
  }

  /**
   * Establishes connection with the Redis server if not already connected.
   */
  public async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  /**
   * Closes connection with the Redis server if connected.
   */
  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  /**
   * Executes the atomic rate limiting Lua script for a given client key.
   * 
   * @param key The Redis key storing the client's bucket hash
   * @param tokensToConsume The number of tokens requested (usually 1)
   * @param refillRate Refill rate of the bucket (tokens/sec)
   * @param capacity Maximum capacity/burst size of the bucket
   * @param now Current timestamp in milliseconds
   * @returns A promise resolving to the execution result
   */
  public async consumeToken(
    key: string,
    tokensToConsume: number,
    refillRate: number,
    capacity: number,
    now: number
  ): Promise<RedisConsumeResult> {
    // The key is passed under KEYS, variables under ARGV in client.eval
    const result = await this.client.eval(LUA_RATE_LIMITER, {
      keys: [key],
      arguments: [
        tokensToConsume.toString(),
        refillRate.toString(),
        capacity.toString(),
        now.toString(),
      ],
    });

    // Redis EVAL returns array values matching Lua returns
    const arr = result as [number, string, string];
    const allowed = arr[0] === 1;
    const tokensRemaining = parseFloat(arr[1]);
    const lastRefillTimeMs = parseInt(arr[2], 10);

    return {
      allowed,
      tokensRemaining,
      lastRefillTimeMs,
    };
  }

  /**
   * Fetches custom client-specific rate limit config overrides from Redis.
   * 
   * @param key Unique key representing the client identifier
   * @returns Config override values or null if no configuration exists
   */
  public async getClientLimitConfig(
    key: string
  ): Promise<{ capacity: number; refillRate: number } | null> {
    const configKey = `rate-limit-config:${key}`;
    const data = await this.client.hGetAll(configKey);
    
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      capacity: parseInt(data.capacity, 10),
      refillRate: parseFloat(data.refillRate),
    };
  }

  /**
   * Saves custom client-specific rate limit configurations in a Redis Hash.
   * Persisted indefinitely until deleted or overwritten via /admin/config.
   * 
   * @param key Client key override target
   * @param capacity Burst size capacity
   * @param refillRate Refill tokens/sec rate
   */
  public async saveClientLimitConfig(
    key: string,
    capacity: number,
    refillRate: number
  ): Promise<void> {
    const configKey = `rate-limit-config:${key}`;
    await this.client.hSet(configKey, {
      capacity: capacity.toString(),
      refillRate: refillRate.toString(),
    });
  }

  /**
   * Records rate limiting decisions in Redis using an atomic transaction pipeline.
   * 
   * Telemetry Keys structure:
   * - `stats:global`: Hash containing total, allowed, and denied counts across all clients.
   * - `stats:clients:total`: Hash tracking total request counts per client key.
   * - `stats:clients:allowed`: Hash tracking allowed requests per client key.
   * - `stats:clients:denied`: Hash tracking denied requests per client key.
   * 
   * @param key Client identifier key
   * @param allowed Decision outcome (true = ALLOW, false = DENY)
   */
  public async recordDecision(key: string, allowed: boolean): Promise<void> {
    const multi = this.client.multi();
    // Increment global counters
    multi.hIncrBy('stats:global', 'total', 1);
    multi.hIncrBy('stats:global', allowed ? 'allowed' : 'denied', 1);

    // Increment client-specific counters
    multi.hIncrBy('stats:clients:total', key, 1);
    multi.hIncrBy(allowed ? 'stats:clients:allowed' : 'stats:clients:denied', key, 1);

    await multi.exec();
  }

  /**
   * Fetches all telemetry metrics currently accumulated in Redis.
   * Parsed counts are aggregated to render the real-time observability panel.
   * 
   * @returns Telemetry JSON metrics object
   */
  public async getMetrics(): Promise<any> {
    const globalData = await this.client.hGetAll('stats:global');
    const clientsTotal = await this.client.hGetAll('stats:clients:total');
    const clientsAllowed = await this.client.hGetAll('stats:clients:allowed');
    const clientsDenied = await this.client.hGetAll('stats:clients:denied');

    const total = parseInt(globalData.total || '0', 10);
    const allowed = parseInt(globalData.allowed || '0', 10);
    const denied = parseInt(globalData.denied || '0', 10);

    const clients: Record<string, { total: number; allowed: number; denied: number }> = {};

    for (const clientKey of Object.keys(clientsTotal)) {
      clients[clientKey] = {
        total: parseInt(clientsTotal[clientKey] || '0', 10),
        allowed: parseInt(clientsAllowed[clientKey] || '0', 10),
        denied: parseInt(clientsDenied[clientKey] || '0', 10),
      };
    }

    return {
      total,
      allowed,
      denied,
      clients,
    };
  }

  /**
   * Resets all telemetry and metrics counters in Redis.
   * Triggered by administrative reset operations (/admin/stats/reset).
   */
  public async resetMetrics(): Promise<void> {
    const multi = this.client.multi();
    multi.del('stats:global');
    multi.del('stats:clients:total');
    multi.del('stats:clients:allowed');
    multi.del('stats:clients:denied');
    await multi.exec();
  }

  /**
   * Flushes all keys in the current Redis database.
   * Strictly used during integration test runs to ensure clean initial states.
   */
  public async flushAll(): Promise<void> {
    await this.client.flushAll();
  }

  /**
   * Exposes the raw client connection.
   * Used for custom low-level operations or assertion mocking in test suites.
   */
  public getRawClient(): RedisClientType {
    return this.client;
  }
}

export const redisStore = new RedisStore();
