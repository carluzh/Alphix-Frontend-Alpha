/**
 * Binary Search Swap Calculator
 *
 * Finds the optimal swap amount for Zap deposits using binary search
 * with actual Hook preview functions. This ensures leftover (dust)
 * is minimized to < 0.01% of input value.
 */

import { type PublicClient, type Address } from 'viem';
import { selectSwapRoute } from '../routing/selectSwapRoute';
import {
  previewAddFromAmount0,
  previewAddFromAmount1,
} from '../../unified-yield/buildUnifiedYieldDepositTx';
import type { ZapToken, RouteDetails } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface OptimalSwapResult {
  /** Amount to swap (in wei of input token) */
  swapAmount: bigint;
  /** Output from swap (in wei of output token) */
  swapOutput: bigint;
  /** Selected route type */
  route: RouteDetails;
  /** Remaining input after swap */
  remainingInput: bigint;
  /** Other token amount required for deposit */
  requiredOther: bigint;
  /** Expected shares from deposit */
  expectedShares: bigint;
  /** Estimated dust as percentage of input */
  estimatedDustPercent: number;
}

export interface FindOptimalSwapParams {
  /** Token user is depositing */
  inputToken: ZapToken;
  /** Total input amount (in wei) */
  inputAmount: bigint;
  /** Hook contract address */
  hookAddress: Address;
  /** Viem public client */
  publicClient: PublicClient;
  /** Max binary search iterations (default: 20) */
  maxIterations?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Minimum convergence threshold as fraction of input (1/10000 = 0.01%) */
const CONVERGENCE_THRESHOLD_DIVISOR = 10000n;

/** USDS decimals */
const USDS_DECIMALS = 18;

/** USDC decimals */
const USDC_DECIMALS = 6;

/** Decimal conversion factor (10^12) */
const DECIMAL_FACTOR = 10n ** 12n;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Binary search to find optimal swap amount for Zap.
 *
 * Goal: Find swapAmount X such that:
 * - swapOutput(X) ≈ requiredOther for (inputAmount - X)
 * - Leftover < 0.01% of input value
 *
 * Algorithm:
 * 1. Start with low=0, high=inputAmount
 * 2. For mid = (low+high)/2:
 *    a. Get swap quote for mid amount
 *    b. Calculate remaining = inputAmount - mid
 *    c. Ask Hook: how much OTHER token needed for remaining?
 *    d. Compare swapOutput vs required
 * 3. Adjust bounds based on comparison
 * 4. Converge when bounds are within 0.01% of input
 *
 * @param params - Search parameters
 * @returns Optimal swap result
 */
export async function findOptimalSwapAmount(
  params: FindOptimalSwapParams
): Promise<OptimalSwapResult> {
  const {
    inputToken,
    inputAmount,
    hookAddress,
    publicClient,
    maxIterations = 20,
  } = params;

  // Early return for zero input
  if (inputAmount <= 0n) {
    return {
      swapAmount: 0n,
      swapOutput: 0n,
      route: { type: 'psm', priceImpact: 0, feeBps: 0 },
      remainingInput: 0n,
      requiredOther: 0n,
      expectedShares: 0n,
      estimatedDustPercent: 0,
    };
  }

  // Convergence threshold: when bounds difference < 0.01% of input
  const convergenceThreshold = inputAmount / CONVERGENCE_THRESHOLD_DIVISOR;

  let low = 0n;
  let high = inputAmount;
  let bestResult: OptimalSwapResult | null = null;

  for (let i = 0; i < maxIterations && high - low > convergenceThreshold; i++) {
    const mid = (low + high) / 2n;

    // Skip if mid is 0 (can't get meaningful quote)
    if (mid === 0n) {
      low = 1n;
      continue;
    }

    try {
      // 1. Get swap quote for this amount
      const routeResult = await selectSwapRoute({
        inputToken,
        swapAmount: mid,
        publicClient,
      });

      // 2. Calculate remaining input after swap
      const remaining = inputAmount - mid;

      // 3. Ask Hook: how much OTHER token needed for `remaining`?
      let preview: { otherAmount: bigint; shares: bigint } | null;

      if (inputToken === 'USDC') {
        // Input is USDC (token1), remaining USDC needs USDS from swap
        // previewAddFromAmount1(USDC amount) → returns required USDS
        preview = await previewAddFromAmount1(hookAddress, remaining, publicClient);
      } else {
        // Input is USDS (token0), remaining USDS needs USDC from swap
        // previewAddFromAmount0(USDS amount) → returns required USDC
        preview = await previewAddFromAmount0(hookAddress, remaining, publicClient);
      }

      if (!preview) {
        // Skip this iteration if preview fails
        console.warn(`[findOptimalSwapAmount] Preview failed at iteration ${i}`);
        continue;
      }

      const required = preview.otherAmount;
      const swapOutput = routeResult.outputAmount;

      // 4. Calculate dust (difference between what we have and what we need)
      const dust = swapOutput > required ? swapOutput - required : required - swapOutput;

      // Normalize dust to input decimals for percentage calculation
      const normalizedDust = normalizeToInputDecimals(dust, inputToken);
      const normalizedInput = inputAmount;
      const dustPercent = Number(normalizedDust * 10000n / normalizedInput) / 100;

      // Track best result
      if (!bestResult || dustPercent < bestResult.estimatedDustPercent) {
        bestResult = {
          swapAmount: mid,
          swapOutput,
          route: routeResult.route,
          remainingInput: remaining,
          requiredOther: required,
          expectedShares: preview.shares,
          estimatedDustPercent: dustPercent,
        };
      }

      // 5. Binary search direction
      if (swapOutput >= required) {
        // Too much output from swap, need to swap less
        high = mid;
      } else {
        // Not enough output from swap, need to swap more
        low = mid;
      }
    } catch (error) {
      console.warn(`[findOptimalSwapAmount] Iteration ${i} error:`, error);
      // On error, narrow the search space from the high end
      high = (low + high) / 2n;
    }
  }

  if (!bestResult) {
    throw new Error('Binary search failed to converge - could not find optimal swap amount');
  }

  console.log(`[findOptimalSwapAmount] Converged:`, {
    swapAmount: bestResult.swapAmount.toString(),
    swapOutput: bestResult.swapOutput.toString(),
    remainingInput: bestResult.remainingInput.toString(),
    requiredOther: bestResult.requiredOther.toString(),
    dustPercent: bestResult.estimatedDustPercent.toFixed(4),
    route: bestResult.route.type,
  });

  return bestResult;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize dust amount to input token decimals for consistent percentage calculation.
 *
 * @param dust - Dust amount in output token decimals
 * @param inputToken - Input token (determines conversion direction)
 * @returns Dust in input token decimals
 */
function normalizeToInputDecimals(dust: bigint, inputToken: ZapToken): bigint {
  if (inputToken === 'USDC') {
    // Input is USDC (6 dec), dust is in USDS (18 dec)
    // Convert USDS to USDC equivalent: divide by 10^12
    return dust / DECIMAL_FACTOR;
  } else {
    // Input is USDS (18 dec), dust is in USDC (6 dec)
    // Convert USDC to USDS equivalent: multiply by 10^12
    return dust * DECIMAL_FACTOR;
  }
}
