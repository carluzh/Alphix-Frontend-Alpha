/**
 * Core cache type definitions and interfaces
 * Defines the contract for all cache implementations
 */

export interface CacheStrategy {
  /**
   * Get a value from cache
   * @returns null if not found or expired
   */
  get<T>(key: string): Promise<T | null>

  /**
   * Set a value in cache with optional TTL
   * @param ttl Time to live in milliseconds
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>

  /**
   * Invalidate a single cache entry
   */
  invalidate(key: string): Promise<void>

  /**
   * Invalidate multiple entries matching a pattern
   * Pattern uses glob syntax: user:* matches user:123, user:456, etc.
   */
  invalidatePattern(pattern: string): Promise<void>
}

export interface TransactionContext {
  owner: string
  poolId?: string
  positionIds?: string[]
  blockNumber?: number
  reason?: string
}

export interface CacheMetrics {
  hits: number
  misses: number
  invalidations: number
  errors: number
}

export type CacheLayer = 'react-query' | 'server' | 'localStorage'

export interface CacheReport {
  layer: CacheLayer
  metrics: CacheMetrics
  hitRate: number
  timestamp: number
}
