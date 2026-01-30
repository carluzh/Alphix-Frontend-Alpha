/**
 * Pool Type Guards
 *
 * Utility functions for identifying pool types.
 * Centralizes pool type checking logic for consistency across the codebase.
 *
 * Pool types are defined in config/pools.json and config/testnet_pools.json
 * under the `type` field: "Standard" | "Stable" | "Unified Yield"
 */

import type { PoolConfig } from '@/lib/pools-config';

/**
 * Check if a pool is a Unified Yield (ReHypothecation) pool
 *
 * Unified Yield pools have:
 * - A rehypoRange config (defines the rehypothecation tick range)
 * - A hooks address (the hook IS the ERC-4626 share token)
 *
 * Note: The pool `type` field (Stable/Volatile) describes price behavior,
 * while Unified Yield is an orthogonal feature enabled by rehypoRange + hooks.
 *
 * @param pool - Pool configuration to check
 * @returns true if the pool supports Unified Yield
 */
export function isUnifiedYieldPool(pool: PoolConfig): boolean {
  return !!pool.rehypoRange && !!pool.hooks;
}

/**
 * Check if a pool is a Stable pool
 *
 * Stable pools typically have tight tick spacing for correlated assets
 * (e.g., USDS/USDC, DAI/USDC)
 *
 * @param pool - Pool configuration to check
 * @returns true if the pool is a stable pool
 */
export function isStablePool(pool: PoolConfig): boolean {
  return pool.type === 'Stable';
}

/**
 * Check if a pool is a Standard pool
 *
 * Standard pools are the default type for uncorrelated assets
 * (e.g., ETH/USDC, BTC/ETH)
 *
 * @param pool - Pool configuration to check
 * @returns true if the pool is a standard pool
 */
export function isStandardPool(pool: PoolConfig): boolean {
  return pool.type === 'Standard' || !pool.type;
}

/**
 * Check if a pool has hooks enabled
 *
 * Note: Having hooks doesn't mean it's Unified Yield.
 * Standard pools can also have hooks (e.g., dynamic fee hooks).
 * Use isUnifiedYieldPool() to specifically check for Unified Yield.
 *
 * @param pool - Pool configuration to check
 * @returns true if the pool has a hooks address
 */
export function hasHooks(pool: PoolConfig): boolean {
  return !!pool.hooks;
}

/**
 * Get the pool type label for display
 *
 * @param pool - Pool configuration
 * @returns Human-readable pool type label
 */
export function getPoolTypeLabel(pool: PoolConfig): string {
  if (isUnifiedYieldPool(pool)) return 'Unified Yield';
  if (isStablePool(pool)) return 'Stable';
  return 'Standard';
}
