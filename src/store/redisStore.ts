import { createClient, RedisClientType } from 'redis';

// Lua script implementing atomic token bucket refills and consumption
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
  local fillTimeSec = math.ceil((capacity / (refillRate / 1000.0)) / 1000.0)
  local ttl = fillTimeSec + 3600
  redis.call('EXPIRE', key, ttl)

  return { allowed, tostring(tokens), tostring(lastRefillTime) }
`;

export interface RedisConsumeResult {
  allowed: boolean;
  tokensRemaining: number;
  lastRefillTimeMs: number;
}

export class RedisStore {
  private client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = createClient({ url: redisUrl });

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

  public async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  /**
   * Execute atomic token consumption script.
   */
  public async consumeToken(
    key: string,
    tokensToConsume: number,
    refillRate: number,
    capacity: number,
    now: number
  ): Promise<RedisConsumeResult> {
    // The keys are passed under KEYS, args under ARGV in client.eval
    const result = await this.client.eval(LUA_RATE_LIMITER, {
      keys: [key],
      arguments: [
        tokensToConsume.toString(),
        refillRate.toString(),
        capacity.toString(),
        now.toString(),
      ],
    });

    // Redis EVAL returns array values
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
   * Fetch custom client-specific rate limit config overrides.
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
   * Save custom client-specific rate limit config overrides.
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
   * Clear all database data (useful for integration tests)
   */
  public async flushAll(): Promise<void> {
    await this.client.flushAll();
  }

  /**
   * Expose raw client for testing or advanced operations
   */
  public getRawClient(): RedisClientType {
    return this.client;
  }
}

export const redisStore = new RedisStore();
