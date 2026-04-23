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

/**
 * Unified Yield pool — rehypothecated stable pool backed by a custom ERC-4626 Hook.
 * The Uniswap Liquidity API does NOT support these; they stay on our legacy builders.
 */
export function isUnifiedYieldPool(pool: PoolConfig): boolean {
  return !!pool.rehypoRange;
}

/**
 * Find the PoolConfig that matches an on-chain V4 poolKey. Uses hooks address
 * as primary key (hooks are unique per pool in our deployment) with currencies
 * as a tiebreaker.
 */
export function findPoolByPoolKey(
  pools: PoolConfig[],
  poolKey: { currency0: string; currency1: string; hooks: string },
): PoolConfig | null {
  const h = poolKey.hooks.toLowerCase();
  const c0 = poolKey.currency0.toLowerCase();
  const c1 = poolKey.currency1.toLowerCase();
  return pools.find(p =>
    p.hooks.toLowerCase() === h &&
    p.currency0.address.toLowerCase() === c0 &&
    p.currency1.address.toLowerCase() === c1,
  ) ?? null;
}
