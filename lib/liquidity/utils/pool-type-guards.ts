/**
 * Pool Type Guards
 *
 * Pool types: "Stable" | "Volatile"
 * - Stable: correlated assets, rehypothecation (Unified Yield), daily dynamic fees
 * - Volatile: uncorrelated assets, LVR dynamic fees, no rehypothecation
 *
 * Unified Yield is orthogonal — enabled by rehypoRange + hooks on Stable pools.
 */

import type { PoolConfig } from '@/lib/pools-config';

/** Stable pool — correlated assets with tight tick spacing (e.g., USDS/USDC) */
export function isStablePool(pool: PoolConfig): boolean {
  return pool.type === 'Stable';
}

/** Volatile pool — uncorrelated assets with LVR dynamic fees (e.g., ETH/USDC) */
export function isVolatilePool(pool: PoolConfig): boolean {
  return pool.type === 'Volatile';
}
