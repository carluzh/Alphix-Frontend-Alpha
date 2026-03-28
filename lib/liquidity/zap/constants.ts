/**
 * Unified Yield Zap Constants
 *
 * Configuration for the Zap feature including PSM addresses,
 * thresholds, and safety parameters.
 *
 * Pool-specific data (addresses, decimals, tick spacing, fees) is derived
 * from the canonical pool config JSONs via lib/pools-config.ts.
 */

import { type Address, getAddress } from 'viem';
import type { ZapToken } from './types';
import { getPoolBySlug, getToken, type NetworkMode } from '@/lib/pools-config';

// =============================================================================
// POOL CONFIG DERIVATION (single source of truth: config/*.json)
// =============================================================================

/**
 * Derive a zap pool base config from the canonical pool config.
 * All addresses, decimals, tick spacing, and fees come from the JSON.
 */
function deriveZapPoolBase(poolId: string, mode: NetworkMode) {
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
    tickSpacing: pool.tickSpacing,
    fee: pool.fee,
  };
}

// =============================================================================
// PSM (PEG STABILITY MODULE) CONFIGURATION
// =============================================================================

/**
 * Spark PSM3 configuration on Base mainnet
 *
 * PSM3 (Peg Stability Module 3) provides 1:1 swaps between USDS and USDC
 * with ZERO fees. This is used as a fallback when pool price impact exceeds
 * our threshold.
 *
 * Key function: swapExactIn(assetIn, assetOut, amountIn, minAmountOut, receiver, referralCode)
 */
const _baseUsds = getToken('USDS', 'base')!;
const _baseUsdc = getToken('USDC', 'base')!;

export const PSM_CONFIG = {
  /** PSM3 contract address on Base mainnet (not in pool config — external contract) */
  address: getAddress('0x1601843c5E9bC251A3272907010AFa41Fa18347E'),
  /** USDS token address — derived from pool config */
  usdsAddress: getAddress(_baseUsds.address),
  /** USDC token address — derived from pool config */
  usdcAddress: getAddress(_baseUsdc.address),
  /** Referral code for tracking (0 = no referral) */
  referralCode: 0,
};

// =============================================================================
// POOL CONFIGURATIONS (derived from config JSONs)
// =============================================================================

/** USDS/USDC Unified Yield pool (Base) */
export const USDS_USDC_POOL_CONFIG = deriveZapPoolBase('usds-usdc', 'base');

/** USDC/USDT Unified Yield pool (Arbitrum) */
export const USDC_USDT_ARB_POOL_CONFIG = deriveZapPoolBase('usdc-usdt', 'arbitrum');

// =============================================================================
// ZAP POOL CONFIG INTERFACE
// =============================================================================

/**
 * Generalized pool configuration for the zap system.
 * Allows the same zap logic to work across different pool types.
 */
export interface ZapPoolConfig {
  poolId: string;
  hookAddress: Address;
  token0: { symbol: ZapToken; address: Address; decimals: number };
  token1: { symbol: ZapToken; address: Address; decimals: number };
  tickSpacing: number;
  fee: number;
  /** Which fallback route to use when price impact exceeds threshold */
  fallbackRoute: 'psm' | 'kyberswap';
  /** Price impact threshold for switching to fallback (as percentage) */
  priceImpactThreshold: number;
  /** Whether the pair is pegged (stablecoins) - affects price impact calculation */
  isPegged: boolean;
}

// =============================================================================
// THRESHOLDS & SAFETY PARAMETERS
// =============================================================================

/**
 * Price impact threshold for PSM fallback (as percentage)
 *
 * If pool swap would cause price impact >= this threshold,
 * we use PSM (1:1 swap) instead.
 *
 * 0.01 = 0.01% price impact
 */
export const PSM_PRICE_IMPACT_THRESHOLD = 0.01;

/**
 * Price impact threshold for Kyberswap fallback (as percentage)
 *
 * For non-pegged pools (ETH/USDC), if pool swap price impact >= this,
 * we route through Kyberswap aggregator instead.
 *
 * 0.5 = 0.5% price impact
 */
export const KYBERSWAP_PRICE_IMPACT_THRESHOLD = 0.5;

/** All zap pool configs */
const ZAP_POOL_CONFIGS: ZapPoolConfig[] = [
  {
    ...USDS_USDC_POOL_CONFIG,
    fallbackRoute: 'psm',
    priceImpactThreshold: PSM_PRICE_IMPACT_THRESHOLD,
    isPegged: true,
  },
  {
    ...USDC_USDT_ARB_POOL_CONFIG,
    fallbackRoute: 'kyberswap',
    priceImpactThreshold: PSM_PRICE_IMPACT_THRESHOLD,
    isPegged: true,
  },
];

/**
 * Get the ZapPoolConfig for a given pool ID.
 * Returns null if the pool doesn't support zap.
 */
export function getZapPoolConfig(poolId: string): ZapPoolConfig | null {
  // Direct match first (most common case)
  const direct = ZAP_POOL_CONFIGS.find(c => c.poolId === poolId);
  if (direct) return direct;

  // Fallback: resolve poolId via multi-chain lookup
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getPoolBySlugMultiChain } = require('@/lib/pools-config');
  const pool = getPoolBySlugMultiChain(poolId);
  if (!pool) return null;

  return ZAP_POOL_CONFIGS.find(c => c.poolId === pool.slug) ?? null;
}

/**
 * Get the ZapPoolConfig by hook contract address.
 * Returns null if no zap pool matches the hook address.
 */
export function getZapPoolConfigByHook(hookAddress: Address): ZapPoolConfig | null {
  const normalizedHook = hookAddress.toLowerCase();
  return ZAP_POOL_CONFIGS.find(c => c.hookAddress.toLowerCase() === normalizedHook) ?? null;
}

/**
 * Get the ZapPoolConfig by matching a pair of token addresses.
 * Returns null if no zap pool matches.
 */
export function getZapPoolConfigByTokens(tokenA: Address, tokenB: Address): ZapPoolConfig | null {
  const a = tokenA.toLowerCase();
  const b = tokenB.toLowerCase();
  return ZAP_POOL_CONFIGS.find(c => {
    const t0 = c.token0.address.toLowerCase();
    const t1 = c.token1.address.toLowerCase();
    return (t0 === a && t1 === b) || (t0 === b && t1 === a);
  }) ?? null;
}

/**
 * Maximum acceptable price impact for pool swap (as percentage)
 *
 * If price impact exceeds this, we reject the transaction entirely
 * (even PSM won't help if the deposit itself would cause issues).
 *
 * 1.0 = 1% price impact
 */
export const MAX_ACCEPTABLE_PRICE_IMPACT = 1.0;

/**
 * Price impact warning threshold (as percentage)
 *
 * Show a warning to the user if impact exceeds this.
 *
 * 0.5 = 0.5% price impact
 */
export const PRICE_IMPACT_WARNING_THRESHOLD = 0.5;

/**
 * Haircut applied to calculated swap amount (as decimal)
 *
 * We reduce the swap amount by this percentage to prevent
 * over-swapping due to price movement between calculation
 * and execution.
 *
 * 0.001 = 0.1% reduction
 */
export const SWAP_AMOUNT_HAIRCUT = 0.001;

/**
 * Maximum preview age in milliseconds
 *
 * If a preview is older than this, we require a fresh one
 * before execution.
 *
 * 30000 = 30 seconds
 */
export const MAX_PREVIEW_AGE_MS = 30_000;

/**
 * Minimum slippage tolerance (as percentage)
 *
 * We enforce a minimum slippage to protect against MEV.
 *
 * 0.05 = 0.05% (5 basis points)
 */
export const MINIMUM_SLIPPAGE_TOLERANCE = 0.05;

/**
 * Default slippage tolerance for zap (as percentage)
 *
 * 0.5 = 0.5%
 */
export const DEFAULT_ZAP_SLIPPAGE = 0.5;

// =============================================================================
// PERMIT2 CONFIGURATION
// =============================================================================

/**
 * Permit2 contract address (same on all EVM chains)
 */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

// =============================================================================
// DECIMAL CONVERSION
// =============================================================================

/**
 * Decimal difference between USDS (18) and USDC (6)
 */
export const USDS_USDC_DECIMAL_DIFF = 12;

/**
 * Multiplier for USDC -> USDS conversion (10^12)
 */
export const USDC_TO_USDS_MULTIPLIER = 10n ** 12n;

/**
 * Divisor for USDS -> USDC conversion (10^12)
 */
export const USDS_TO_USDC_DIVISOR = 10n ** 12n;

// =============================================================================
// ZAP ELIGIBILITY
// =============================================================================

/**
 * Check if a pool supports the Zap feature.
 *
 * Enabled for Stable Unified Yield pools (USDS/USDC, USDC/USDT).
 * Accepts either pool config id ('usds-usdc') or poolId (bytes32 hash)
 * since positions may use either format.
 *
 * @param poolId - The pool ID to check (can be config id or poolId)
 * @returns True if the pool supports Zap
 */
export function isZapEligiblePool(poolId: string | null): boolean {
  if (!poolId) return false;
  return getZapPoolConfig(poolId) !== null;
}
