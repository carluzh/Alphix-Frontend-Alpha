/**
 * Calculate Optimal Swap Amount for Zap
 *
 * Pure calculation functions for determining how much to swap
 * when depositing a single token into the Unified Yield pool.
 *
 * For stablecoins near peg, we use an analytical formula instead
 * of iterative/binary search - this gives O(1) calculation with
 * minimal error.
 */

import { SWAP_AMOUNT_HAIRCUT, USDC_TO_USDS_MULTIPLIER, USDS_TO_USDC_DIVISOR } from '../constants';
import type { TokenPosition, ZapToken } from '../types';

// =============================================================================
// CORE CALCULATION
// =============================================================================

/**
 * Calculate the optimal amount to swap for a balanced deposit.
 *
 * Given:
 * - User has `inputAmount` of one token
 * - Pool requires ratio of token0:token1 (from previewAddFromAmount0/1)
 * - Swap will convert some input to the other token
 *
 * Goal: After swap + deposit, minimize leftover (dust)
 *
 * Formula derivation:
 * Let S = swap amount, R = remaining = inputAmount - S
 * After swap: we have R of input token, S*rate of other token
 * For balanced deposit: R / (S*rate) = 1/poolRatio
 * Solving for S: S = inputAmount * poolRatio / (1 + poolRatio * rate)
 *
 * @param inputPosition - Which token user is depositing ('token0' or 'token1')
 * @param inputAmount - Amount of input token (in wei)
 * @param poolRatio - Pool's token1/token0 ratio (from preview)
 * @param swapRate - Expected output/input rate (1.0 for PSM, ~0.999 for pool)
 * @returns Optimal amount to swap (in wei of input token)
 */
export function calculateOptimalSwapAmount(
  inputPosition: TokenPosition,
  inputAmount: bigint,
  poolRatio: number,
  swapRate: number = 1.0
): bigint {
  // Input validation
  if (inputAmount <= 0n) {
    return 0n;
  }

  if (poolRatio <= 0 || !Number.isFinite(poolRatio)) {
    throw new Error(`Invalid pool ratio: ${poolRatio}`);
  }

  if (swapRate <= 0 || swapRate > 1.1) {
    throw new Error(`Invalid swap rate: ${swapRate}`);
  }

  // Calculate swap ratio based on which token we're depositing
  let swapRatio: number;

  if (inputPosition === 'token0') {
    // User has token0 (USDS), needs to get some token1 (USDC)
    // swapRatio = poolRatio / (1 + poolRatio * swapRate)
    swapRatio = poolRatio / (1 + poolRatio * swapRate);
  } else {
    // User has token1 (USDC), needs to get some token0 (USDS)
    // Use inverse ratio
    const inverseRatio = 1 / poolRatio;
    swapRatio = inverseRatio / (1 + inverseRatio * swapRate);
  }

  // Calculate raw swap amount
  const swapAmountFloat = Number(inputAmount) * swapRatio;
  let swapAmount = BigInt(Math.floor(swapAmountFloat));

  // Apply haircut to prevent over-swapping due to price movement
  // between calculation and execution
  const haircut = (swapAmount * BigInt(Math.floor(SWAP_AMOUNT_HAIRCUT * 10000))) / 10000n;
  swapAmount = swapAmount - haircut;

  // Ensure we don't swap more than input
  if (swapAmount > inputAmount) {
    swapAmount = inputAmount;
  }

  // Ensure non-negative
  if (swapAmount < 0n) {
    swapAmount = 0n;
  }

  return swapAmount;
}

// =============================================================================
// POOL RATIO HELPERS
// =============================================================================

/**
 * Calculate pool ratio from preview results.
 *
 * The Hook's previewAddFromAmount0(amount0) returns (amount1Required, shares).
 * Pool ratio = amount1Required / amount0
 *
 * Note: We need to normalize for different decimals (USDS=18, USDC=6)
 *
 * @param amount0 - Input amount of token0 used for preview (in wei)
 * @param amount1Required - Required amount of token1 (in wei)
 * @param token0Decimals - Decimals of token0 (e.g., 18 for USDS)
 * @param token1Decimals - Decimals of token1 (e.g., 6 for USDC)
 * @returns Pool ratio (token1/token0) normalized to same units
 */
export function calculatePoolRatio(
  amount0: bigint,
  amount1Required: bigint,
  token0Decimals: number,
  token1Decimals: number
): number {
  if (amount0 <= 0n) {
    throw new Error('amount0 must be positive');
  }

  // Normalize both to 18 decimals for comparison
  const amount0Normalized = Number(amount0) / 10 ** token0Decimals;
  const amount1Normalized = Number(amount1Required) / 10 ** token1Decimals;

  // For stablecoins, ratio should be close to 1.0
  const ratio = amount1Normalized / amount0Normalized;

  return ratio;
}

/**
 * Calculate inverse pool ratio from preview results.
 *
 * The Hook's previewAddFromAmount1(amount1) returns (amount0Required, shares).
 * Inverse ratio = amount0Required / amount1
 *
 * @param amount1 - Input amount of token1 used for preview (in wei)
 * @param amount0Required - Required amount of token0 (in wei)
 * @param token0Decimals - Decimals of token0
 * @param token1Decimals - Decimals of token1
 * @returns Pool ratio (token1/token0) - same format as calculatePoolRatio
 */
export function calculatePoolRatioFromToken1(
  amount1: bigint,
  amount0Required: bigint,
  token0Decimals: number,
  token1Decimals: number
): number {
  if (amount1 <= 0n) {
    throw new Error('amount1 must be positive');
  }

  // Normalize both to 18 decimals for comparison
  const amount0Normalized = Number(amount0Required) / 10 ** token0Decimals;
  const amount1Normalized = Number(amount1) / 10 ** token1Decimals;

  // Ratio is still token1/token0
  const ratio = amount1Normalized / amount0Normalized;

  return ratio;
}

// =============================================================================
// POST-SWAP AMOUNT CALCULATION
// =============================================================================

/**
 * Calculate expected amounts after swap for deposit.
 *
 * @param inputToken - Which token user is depositing
 * @param inputAmount - Total input amount (in wei)
 * @param swapAmount - Amount to swap (in wei of input token)
 * @param swapOutputAmount - Expected output from swap (in wei of other token)
 * @returns Amounts of each token available for deposit
 */
export function calculatePostSwapAmounts(
  inputToken: ZapToken,
  inputAmount: bigint,
  swapAmount: bigint,
  swapOutputAmount: bigint
): { token0Amount: bigint; token1Amount: bigint } {
  const remainingInput = inputAmount - swapAmount;

  if (inputToken === 'USDS') {
    // User had USDS (token0), swapped some for USDC (token1)
    return {
      token0Amount: remainingInput,
      token1Amount: swapOutputAmount,
    };
  } else {
    // User had USDC (token1), swapped some for USDS (token0)
    return {
      token0Amount: swapOutputAmount,
      token1Amount: remainingInput,
    };
  }
}

// =============================================================================
// PSM OUTPUT CALCULATION
// =============================================================================

/**
 * Calculate PSM swap output (1:1 with decimal adjustment).
 *
 * PSM swaps are 1:1 in USD terms, but we need to adjust for decimals:
 * - USDS has 18 decimals
 * - USDC has 6 decimals
 *
 * @param inputToken - Which token we're swapping from
 * @param inputAmount - Amount to swap (in wei)
 * @returns Expected output amount (in wei of other token)
 */
export function calculatePSMOutput(
  inputToken: ZapToken,
  inputAmount: bigint
): bigint {
  if (inputAmount <= 0n) {
    return 0n;
  }

  if (inputToken === 'USDS') {
    // USDS (18 dec) -> USDC (6 dec): divide by 10^12
    return inputAmount / USDS_TO_USDC_DIVISOR;
  } else {
    // USDC (6 dec) -> USDS (18 dec): multiply by 10^12
    return inputAmount * USDC_TO_USDS_MULTIPLIER;
  }
}

// =============================================================================
// LEFTOVER ESTIMATION
// =============================================================================

/**
 * Estimate leftover amounts after deposit.
 *
 * Even with optimal calculation, there may be small leftovers (dust)
 * due to rounding and price movement.
 *
 * @param token0Available - Token0 amount available for deposit
 * @param token1Available - Token1 amount available for deposit
 * @param token0Used - Token0 amount used by deposit (from preview)
 * @param token1Used - Token1 amount used by deposit (from preview)
 * @returns Leftover amounts
 */
export function estimateLeftover(
  token0Available: bigint,
  token1Available: bigint,
  token0Used: bigint,
  token1Used: bigint
): { leftover0: bigint; leftover1: bigint } {
  const leftover0 = token0Available > token0Used ? token0Available - token0Used : 0n;
  const leftover1 = token1Available > token1Used ? token1Available - token1Used : 0n;

  return { leftover0, leftover1 };
}

/**
 * Calculate leftover as percentage of input value.
 *
 * @param leftover0 - Leftover token0 (in wei)
 * @param leftover1 - Leftover token1 (in wei)
 * @param inputAmount - Original input amount (in wei)
 * @param inputToken - Which token was input
 * @returns Leftover as percentage (e.g., 0.01 = 0.01%)
 */
export function calculateLeftoverPercent(
  leftover0: bigint,
  leftover1: bigint,
  inputAmount: bigint,
  inputToken: ZapToken
): number {
  if (inputAmount <= 0n) {
    return 0;
  }

  // Convert both leftovers to input token terms
  let totalLeftoverInInputTerms: bigint;

  if (inputToken === 'USDS') {
    // leftover0 is already in USDS terms
    // Convert leftover1 (USDC) to USDS terms (multiply by 10^12)
    const leftover1InUsds = leftover1 * USDC_TO_USDS_MULTIPLIER;
    totalLeftoverInInputTerms = leftover0 + leftover1InUsds;
  } else {
    // leftover1 is already in USDC terms
    // Convert leftover0 (USDS) to USDC terms (divide by 10^12)
    const leftover0InUsdc = leftover0 / USDS_TO_USDC_DIVISOR;
    totalLeftoverInInputTerms = leftover1 + leftover0InUsdc;
  }

  // Calculate percentage
  const percent = (Number(totalLeftoverInInputTerms) / Number(inputAmount)) * 100;

  return percent;
}
