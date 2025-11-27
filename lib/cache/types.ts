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
}

export interface CacheResult<T> {
  data: T | null
  isStale: boolean
  isInvalidated: boolean
}

export interface CacheApiResult<T> {
  data: T
  isStale: boolean
}
