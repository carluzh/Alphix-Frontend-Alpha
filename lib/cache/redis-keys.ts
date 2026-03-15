/**
 * Centralized Redis cache key generation
 *
 * This module provides consistent key naming for all Redis cache operations.
 * All keys follow the pattern: `{resource}:{identifier}[:version]`
 */

/**
 * Pool-related cache keys
 */
import type { NetworkMode } from '@/lib/network-mode'

function networkSuffix(networkMode?: NetworkMode): string {
  return networkMode ? `:${networkMode}` : ''
}

export const poolKeys = {
  /**
   * Batch data for all pools
   * TTL: 5min fresh, 15min stale
   */
  batch: (version: string = 'v1', networkMode?: NetworkMode) => `pools-batch:${version}${networkSuffix(networkMode)}`,

  /**
   * Pool chart data (volume/TVL over time)
   * TTL: 1h
   */
  chart: (poolId: string, days: number, networkMode?: NetworkMode) => `pool:chart:${poolId.toLowerCase()}:${days}d${networkSuffix(networkMode)}`,

  /**
   * Pool tick data (liquidityGross, liquidityNet per tick)
   * TTL: 5min fresh, 1hr stale
   */
  ticks: (poolId: string, networkMode?: NetworkMode) => `pool:ticks:${poolId.toLowerCase()}${networkSuffix(networkMode)}`,

  /**
   * Pool metrics (APY calculations, TVL, volume)
   * TTL: 5min fresh, 1hr stale
   */
  metrics: (poolId: string, days: number, networkMode?: NetworkMode) => `pool:metrics:${poolId.toLowerCase()}:${days}d${networkSuffix(networkMode)}`,
} as const;

/**
 * Price-related cache keys
 */
export const priceKeys = {
  /**
   * All token prices (batch)
   * TTL: 5min
   */
  batch: (networkMode?: NetworkMode) => `prices:all${networkSuffix(networkMode)}`,

  /**
   * Individual token price
   * TTL: 5min
   */
  token: (symbol: string, networkMode?: NetworkMode) => `price:${symbol.toUpperCase()}${networkSuffix(networkMode)}`,
} as const;

