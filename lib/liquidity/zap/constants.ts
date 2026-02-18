/**
 * Unified Yield Zap Constants
 *
 * Configuration for the Zap feature including PSM addresses,
 * thresholds, and safety parameters.
 */

import { type Address, getAddress } from 'viem';

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
 * Contract: Spark PSM3
 * Source: Spark Protocol (SparkDAO)
 *
 * Key function: swapExactIn(assetIn, assetOut, amountIn, minAmountOut, receiver, referralCode)
 */
export const PSM_CONFIG = {
  /** PSM3 contract address on Base mainnet */
  address: getAddress('0x1601843c5E9bC251A3272907010AFa41Fa18347E'),

  /** USDS token address (18 decimals) */
  usdsAddress: getAddress('0x820C137fa70C8691f0e44Dc420a5e53c168921Dc'),

  /** USDC token address (6 decimals) */
  usdcAddress: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),

  /** Referral code for tracking (0 = no referral) */
  referralCode: 0,
};

// =============================================================================
// POOL CONFIGURATION
// =============================================================================

/**
 * USDS/USDC Unified Yield pool configuration
 */
export const USDS_USDC_POOL_CONFIG = {
  /** Pool ID */
  poolId: 'usds-usdc',

  /** Hook contract address (also the share token) - checksummed */
  hookAddress: getAddress('0x0e4b892Df7C5Bcf5010FAF4AA106074e555660C0'),

  /** Token0 is USDS (18 decimals) */
  token0: {
    symbol: 'USDS' as const,
    address: getAddress('0x820C137fa70C8691f0e44Dc420a5e53c168921Dc'),
    decimals: 18,
  },

  /** Token1 is USDC (6 decimals) */
  token1: {
    symbol: 'USDC' as const,
    address: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    decimals: 6,
  },

  /** Pool tick spacing */
  tickSpacing: 1,

  /** Pool fee (dynamic fee flag) */
  fee: 8388608,
};

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
 * Currently enabled ONLY for USDS/USDC pool for testing.
 *
 * @param poolId - The pool ID to check
 * @returns True if the pool supports Zap
 */
export function isZapEligiblePool(poolId: string | null): boolean {
  return poolId === USDS_USDC_POOL_CONFIG.poolId;
}
