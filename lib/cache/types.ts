/**
 * Cache TypeScript Types
 *
 * Shared types for the centralized CacheService.
 */

export interface TTLConfig {
  /** Fresh TTL in seconds - data is considered fresh within this time */
  fresh: number
  /** Stale TTL in seconds - total lifetime including stale window */
  stale: number
}

export interface CacheOptions {
  ttl?: TTLConfig
  skipCache?: boolean
  /**
   * Optional guard to prevent caching obviously invalid payloads.
   * Return false to skip cache writes (response still returned to caller).
   */
  shouldCache?: (data: unknown) => boolean
}

export interface CacheResult<T> {
  data: T | null
  isStale: boolean
  isInvalidated: boolean
  noCacheUntil?: number
}

export interface CacheApiResult<T> {
  data: T
  isStale: boolean
}
