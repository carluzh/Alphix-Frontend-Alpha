// Comprehensive rate limiter for subgraph and RPC calls
// Implements token bucket algorithm with configurable limits

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  capacity: number; // Max tokens (requests)
  refillRate: number; // Tokens per second
  burstCapacity?: number; // Allow burst up to this amount
}

class TokenBucket {
  private config: RateLimitConfig;
  private state: RateLimitBucket;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.state = {
      tokens: config.capacity,
      lastRefill: Date.now(),
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.state.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.config.refillRate;

    this.state.tokens = Math.min(
      this.config.capacity,
      this.state.tokens + tokensToAdd
    );
    this.state.lastRefill = now;
  }

  consume(tokens: number = 1): boolean {
    this.refill();

    if (this.state.tokens >= tokens) {
      this.state.tokens -= tokens;
      return true;
    }

    return false;
  }

  getStatus(): { available: number; capacity: number; nextRefill: number } {
    this.refill();
    const timeToNextToken = (1 / this.config.refillRate) * 1000;
    return {
      available: Math.floor(this.state.tokens),
      capacity: this.config.capacity,
      nextRefill: this.state.lastRefill + timeToNextToken,
    };
  }
}

// Global rate limiters
const subgraphLimiter = new TokenBucket({
  capacity: Number(process.env.SUBGRAPH_RATE_LIMIT_CAPACITY || 10), // 10 requests
  refillRate: Number(process.env.SUBGRAPH_RATE_LIMIT_REFILL || 2), // 2 per second
});

const rpcLimiter = new TokenBucket({
  capacity: Number(process.env.RPC_RATE_LIMIT_CAPACITY || 20), // 20 requests
  refillRate: Number(process.env.RPC_RATE_LIMIT_REFILL || 5), // 5 per second
});

// Rate limiting middleware for API routes
export async function rateLimitMiddleware(
  request: Request,
  context: { type: 'subgraph' | 'rpc'; endpoint?: string }
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const limiter = context.type === 'subgraph' ? subgraphLimiter : rpcLimiter;

  if (limiter.consume()) {
    return { allowed: true };
  }

  const status = limiter.getStatus();
  const retryAfter = Math.ceil((status.nextRefill - Date.now()) / 1000);

  return {
    allowed: false,
    retryAfter: Math.max(1, retryAfter),
  };
}

// Enhanced exponential backoff with jitter
export function calculateBackoff(attempt: number, baseMs: number = 1000, maxMs: number = 30000): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.random() * 0.1 * exponential; // 10% jitter
  return Math.floor(exponential + jitter);
}

// Rate limit-aware retry wrapper
export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: {
    type: 'subgraph' | 'rpc';
    maxAttempts?: number;
    baseBackoffMs?: number;
    onRateLimit?: (attempt: number, retryAfter: number) => void;
    signal?: AbortSignal;
  }
): Promise<T> {
  const { type, maxAttempts = 3, baseBackoffMs = 1000, onRateLimit, signal } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    try {
      const rateLimit = await rateLimitMiddleware({} as Request, { type });

      if (!rateLimit.allowed) {
        if (onRateLimit) {
          onRateLimit(attempt, rateLimit.retryAfter || 1);
        }
        await new Promise(resolve => setTimeout(resolve, (rateLimit.retryAfter || 1) * 1000));
        continue;
      }

      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if it's a rate limit error
      if (error instanceof Error && /rate.?limit|429/i.test(error.message)) {
        if (attempt < maxAttempts - 1) {
          const backoff = calculateBackoff(attempt, baseBackoffMs);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
      }

      // For other errors, don't retry
      throw error;
    }
  }

  throw lastError || new Error('Operation failed after retries');
}

// Status reporting for monitoring
export function getRateLimitStatus(): {
  subgraph: ReturnType<TokenBucket['getStatus']>;
  rpc: ReturnType<TokenBucket['getStatus']>;
} {
  return {
    subgraph: subgraphLimiter.getStatus(),
    rpc: rpcLimiter.getStatus(),
  };
}

// Reset rate limiters (useful for testing)
export function resetRateLimiters(): void {
  subgraphLimiter['state'] = { tokens: subgraphLimiter['config'].capacity, lastRefill: Date.now() };
  rpcLimiter['state'] = { tokens: rpcLimiter['config'].capacity, lastRefill: Date.now() };
}


