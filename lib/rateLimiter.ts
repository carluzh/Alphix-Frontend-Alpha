/**
 * Rate Limiter with Provider Fallback Pattern
 *
 * Based on Uniswap's AppJsonRpcProvider pattern - uses per-endpoint controllers
 * with exponential backoff instead of global in-memory rate limiting.
 *
 * NOTE: Global in-memory rate limiting removed - ineffective in serverless environments.
 * Each serverless instance gets its own state, making coordinated rate limiting impossible.
 *
 * @see interface/apps/web/src/rpc/AppJsonRpcProvider.ts (Uniswap's implementation)
 */

// Default backoff time (12 seconds - average L1 block time)
const AVERAGE_BLOCK_TIME_MS = 12000

/**
 * Controller - Manages endpoint health with exponential backoff
 *
 * Marks itself disabled on error, re-enables using exponential backoff.
 * After each retry, waits twice as long. After success, resets backoff.
 *
 * @see interface/apps/web/src/rpc/AppJsonRpcProvider.ts
 */
export class EndpointController {
  private isEnabled = true
  private timeout: ReturnType<typeof setTimeout> | undefined
  private exponentialBackoffFactor = 1
  private minimumBackoffTime: number
  private lastError: Error | undefined

  constructor(minimumBackoffTime: number = AVERAGE_BLOCK_TIME_MS) {
    this.minimumBackoffTime = minimumBackoffTime
  }

  private reset() {
    this.isEnabled = true
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = undefined
    }
  }

  onSuccess() {
    this.reset()
    this.exponentialBackoffFactor = 1
    this.lastError = undefined
  }

  /**
   * Called onError.
   * Idempotent - calling multiple times will NOT reset the exponential backoff timer.
   */
  onError(error?: Error) {
    this.lastError = error
    this.isEnabled = false

    if (!this.timeout) {
      this.timeout = setTimeout(() => {
        this.reset()
        this.exponentialBackoffFactor *= 2
      }, this.minimumBackoffTime * this.exponentialBackoffFactor)
    }
  }

  get enabled() {
    return this.isEnabled
  }

  get backoffMs() {
    return this.minimumBackoffTime * this.exponentialBackoffFactor
  }

  getLastError() {
    return this.lastError
  }
}

/**
 * Controlled Endpoint - Pairs an endpoint URL with its controller
 */
export interface ControlledEndpoint {
  url: string
  controller: EndpointController
}

/**
 * Create controlled endpoints from URLs
 */
export function createControlledEndpoints(
  urls: string[],
  minimumBackoffTime?: number
): ControlledEndpoint[] {
  return urls.map(url => ({
    url,
    controller: new EndpointController(minimumBackoffTime)
  }))
}

/**
 * Sort endpoints - try enabled ones first
 * Note: We do NOT filter out disabled endpoints, just deprioritize them.
 */
export function sortEndpoints(endpoints: ControlledEndpoint[]): ControlledEndpoint[] {
  return [...endpoints].sort(({ controller: { enabled: a } }, { controller: { enabled: b } }) => {
    if (a && !b) return -1
    if (!a && b) return 1
    return 0 // stable sort
  })
}

/**
 * Execute operation with fallback across multiple endpoints
 *
 * Tries each endpoint in order (enabled first), falls back on failure.
 * Each endpoint has its own exponential backoff controller.
 */
export async function withFallback<T>(
  endpoints: ControlledEndpoint[],
  operation: (url: string) => Promise<T>,
  options?: { signal?: AbortSignal }
): Promise<T> {
  const sortedEndpoints = sortEndpoints(endpoints)

  for (const { url, controller } of sortedEndpoints) {
    if (options?.signal?.aborted) {
      throw new Error('Operation aborted')
    }

    try {
      const result = await operation(url)
      controller.onSuccess()
      return result
    } catch (error) {
      console.warn(`[RateLimiter] Endpoint failed: ${url}`, error)
      controller.onError(error as Error)
    }
  }

  throw new Error('All endpoints failed to perform the operation')
}

/**
 * Enhanced exponential backoff with jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseMs - Base backoff time in milliseconds
 * @param maxMs - Maximum backoff time in milliseconds
 * @returns Backoff time in milliseconds with jitter
 */
export function calculateBackoff(
  attempt: number,
  baseMs: number = 1000,
  maxMs: number = 30000
): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt))
  const jitter = Math.random() * 0.1 * exponential // 10% jitter
  return Math.floor(exponential + jitter)
}

/**
 * Retry wrapper with exponential backoff
 *
 * For single-endpoint operations that need retry logic.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number
    baseBackoffMs?: number
    maxBackoffMs?: number
    onRetry?: (attempt: number, error: Error, backoffMs: number) => void
    signal?: AbortSignal
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseBackoffMs = 1000,
    maxBackoffMs = 30000,
    onRetry,
    signal
  } = options

  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      // Check if it's a rate limit error (429 or rate limit message)
      const isRateLimitError = error instanceof Error &&
        (/rate.?limit|429/i.test(error.message) || (error as any).status === 429)

      if (isRateLimitError && attempt < maxAttempts - 1) {
        const backoff = calculateBackoff(attempt, baseBackoffMs, maxBackoffMs)
        onRetry?.(attempt, lastError, backoff)
        await new Promise(resolve => setTimeout(resolve, backoff))
        continue
      }

      // For non-rate-limit errors, throw immediately
      if (!isRateLimitError) {
        throw error
      }
    }
  }

  throw lastError || new Error('Operation failed after retries')
}

/**
 * Combined fallback + retry wrapper
 *
 * Tries each endpoint with retry logic before moving to next.
 */
export async function withFallbackAndRetry<T>(
  endpoints: ControlledEndpoint[],
  operation: (url: string) => Promise<T>,
  options?: {
    maxRetries?: number
    baseBackoffMs?: number
    signal?: AbortSignal
  }
): Promise<T> {
  const { maxRetries = 2, baseBackoffMs = 1000, signal } = options || {}
  const sortedEndpoints = sortEndpoints(endpoints)

  for (const { url, controller } of sortedEndpoints) {
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    try {
      const result = await withRetry(
        () => operation(url),
        { maxAttempts: maxRetries, baseBackoffMs, signal }
      )
      controller.onSuccess()
      return result
    } catch (error) {
      console.warn(`[RateLimiter] Endpoint exhausted retries: ${url}`, error)
      controller.onError(error as Error)
    }
  }

  throw new Error('All endpoints failed after retries')
}

// =============================================================================
// LEGACY EXPORTS (for backwards compatibility during migration)
// =============================================================================

/**
 * @deprecated Use withFallback or withRetry instead
 * This function is kept for backwards compatibility but uses the new pattern internally.
 */
export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: {
    type: 'subgraph' | 'rpc'
    maxAttempts?: number
    baseBackoffMs?: number
    onRateLimit?: (attempt: number, retryAfter: number) => void
    signal?: AbortSignal
  }
): Promise<T> {
  const { maxAttempts = 3, baseBackoffMs = 1000, onRateLimit, signal } = options

  return withRetry(operation, {
    maxAttempts,
    baseBackoffMs,
    signal,
    onRetry: (attempt, _error, backoffMs) => {
      onRateLimit?.(attempt, Math.ceil(backoffMs / 1000))
    }
  })
}

/**
 * @deprecated Rate limit status not available in provider fallback pattern
 * Returns mock status for backwards compatibility.
 */
export function getRateLimitStatus(): {
  subgraph: { available: number; capacity: number; nextRefill: number }
  rpc: { available: number; capacity: number; nextRefill: number }
} {
  console.warn('[RateLimiter] getRateLimitStatus is deprecated - using provider fallback pattern')
  return {
    subgraph: { available: 10, capacity: 10, nextRefill: Date.now() },
    rpc: { available: 20, capacity: 20, nextRefill: Date.now() }
  }
}

/**
 * @deprecated No global state to reset in provider fallback pattern
 */
export function resetRateLimiters(): void {
  console.warn('[RateLimiter] resetRateLimiters is deprecated - using provider fallback pattern')
}

/**
 * @deprecated Use withFallback instead
 */
export async function rateLimitMiddleware(
  _request: Request,
  _context: { type: 'subgraph' | 'rpc'; endpoint?: string }
): Promise<{ allowed: boolean; retryAfter?: number }> {
  console.warn('[RateLimiter] rateLimitMiddleware is deprecated - using provider fallback pattern')
  return { allowed: true }
}
