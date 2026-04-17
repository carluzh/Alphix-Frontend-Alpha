/**
 * Pool Type Guards
 *
 * Pool types: "Stable" | "Volatile" | "Pro"
 * - Stable: correlated assets, rehypothecation (Unified Yield), daily dynamic fees
 * - Volatile: uncorrelated assets, LVR dynamic fees, no rehypothecation
 * - Pro: external project pools using Alphix Pro hooks (e.g., ETH/ZFI with AlphixPro asymmetric fees)
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

/** Pro pool — external project pool using an Alphix Pro hook (e.g., ETH/ZFI with AlphixPro) */
export function isProPool(pool: PoolConfig): boolean {
  return pool.type === 'Pro';
}
