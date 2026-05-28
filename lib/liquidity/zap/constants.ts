/**
 * Zap Constants
 *
 * Live zap pool: USDC/USDT on Arbitrum (the only Unified Yield pool that
 * supports single-token zap deposits today). Routes always go through
 * Kyberswap; the in-pool swap quoter has been removed.
 */

import { type Address, getAddress } from 'viem';
import type { ZapToken } from './types';
import { getPoolBySlug, getToken, type NetworkMode } from '@/lib/pools-config';

// =============================================================================
// POOL CONFIG (derived from canonical config JSON)
// =============================================================================

export interface ZapPoolConfig {
  poolId: string;
  hookAddress: Address;
  token0: { symbol: ZapToken; address: Address; decimals: number };
  token1: { symbol: ZapToken; address: Address; decimals: number };
}

function deriveZapPoolBase(poolId: string, mode: NetworkMode): ZapPoolConfig {
  const pool = getPoolBySlug(poolId, mode);
  if (!pool) throw new Error(`[zap/constants] Pool "${poolId}" not found in ${mode} config`);
  const t0 = getToken(pool.currency0.symbol, mode);
  const t1 = getToken(pool.currency1.symbol, mode);
  if (!t0 || !t1) throw new Error(`[zap/constants] Tokens for pool "${poolId}" not found`);
  return {
    poolId: pool.slug,
    hookAddress: getAddress(pool.hooks) as Address,
    token0: { symbol: t0.symbol as ZapToken, address: getAddress(t0.address) as Address, decimals: t0.decimals },
    token1: { symbol: t1.symbol as ZapToken, address: getAddress(t1.address) as Address, decimals: t1.decimals },
  };
}

/** All zap-eligible pool configs. */
const ZAP_POOL_CONFIGS: ZapPoolConfig[] = [
  deriveZapPoolBase('usdc-usdt', 'arbitrum'),
];

// =============================================================================
// POOL RESOLUTION
// =============================================================================

/** Resolve a zap pool config by pool slug (or canonical poolId). */
export function getZapPoolConfig(poolId: string): ZapPoolConfig | null {
  const direct = ZAP_POOL_CONFIGS.find(c => c.poolId === poolId);
  if (direct) return direct;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getPoolBySlugMultiChain } = require('@/lib/pools-config');
  const pool = getPoolBySlugMultiChain(poolId);
  if (!pool) return null;
  return ZAP_POOL_CONFIGS.find(c => c.poolId === pool.slug) ?? null;
}

/** Resolve a zap pool config by Hook contract address. */
export function getZapPoolConfigByHook(hookAddress: Address): ZapPoolConfig | null {
  const normalizedHook = hookAddress.toLowerCase();
  return ZAP_POOL_CONFIGS.find(c => c.hookAddress.toLowerCase() === normalizedHook) ?? null;
}

/** Resolve a zap pool config by matching the (tokenA, tokenB) pair. */
export function getZapPoolConfigByTokens(tokenA: Address, tokenB: Address): ZapPoolConfig | null {
  const a = tokenA.toLowerCase();
  const b = tokenB.toLowerCase();
  return ZAP_POOL_CONFIGS.find(c => {
    const t0 = c.token0.address.toLowerCase();
    const t1 = c.token1.address.toLowerCase();
    return (t0 === a && t1 === b) || (t0 === b && t1 === a);
  }) ?? null;
}

/** Whether a pool supports zap deposits. */
export function isZapEligiblePool(poolId: string | null): boolean {
  if (!poolId) return false;
  return getZapPoolConfig(poolId) !== null;
}

// =============================================================================
// MISC
// =============================================================================

/** Cap on preview freshness before we require a refetch. */
export const MAX_PREVIEW_AGE_MS = 30_000;

/** Permit2 contract address (same on every EVM chain). */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;
