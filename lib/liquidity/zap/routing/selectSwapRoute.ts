/**
 * Swap Route Selector
 *
 * Determines whether to use PSM (1:1 swap) or pool swap
 * based on price impact threshold.
 */

import { type PublicClient, type Address, getAddress, parseAbi } from 'viem';
import { getPSMQuote, type PSMQuoteResult } from './psmQuoter';
import { calculatePriceImpact, analyzePriceImpact } from '../calculation';
import { PSM_CONFIG, USDS_USDC_POOL_CONFIG } from '../constants';
import type { ZapToken, RouteDetails, PSMRouteDetails, PoolRouteDetails } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface RouteSelectionParams {
  /** Token to swap from */
  inputToken: ZapToken;
  /** Amount to swap (in wei) */
  swapAmount: bigint;
  /** Public client for on-chain queries */
  publicClient: PublicClient;
  /** Optional: skip PSM and force pool swap */
  forcePoolSwap?: boolean;
  /** Optional: skip pool and force PSM */
  forcePSM?: boolean;
}

export interface RouteSelectionResult {
  /** Selected route details */
  route: RouteDetails;
  /** Output amount from the swap */
  outputAmount: bigint;
  /** Price impact as percentage */
  priceImpact: number;
  /** Whether PSM was selected */
  usedPSM: boolean;
  /** Reason for route selection */
  reason: string;
  /** Pool quote (if fetched) */
  poolQuote?: PoolQuoteResult;
  /** PSM quote (if fetched) */
  psmQuote?: PSMQuoteResult;
}

export interface PoolQuoteResult {
  /** Output amount */
  amountOut: bigint;
  /** Gas estimate */
  gasEstimate: bigint;
  /** Dynamic fee in basis points */
  dynamicFeeBps?: number;
}

// =============================================================================
// QUOTER ABI
// =============================================================================

// Use same ABI format as swap-constants.ts (which works correctly)
// QuoteExactSingleParams struct: { poolKey: { currency0, currency1, fee, tickSpacing, hooks }, zeroForOne, exactAmount, hookData }
const V4_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) external returns (uint256 amountOut, uint256 gasEstimate)',
]);

// =============================================================================
// POOL QUOTE
// =============================================================================

/**
 * Get a quote from the V4 pool.
 *
 * @param inputToken - Token to swap from
 * @param swapAmount - Amount to swap (in wei)
 * @param publicClient - Viem public client
 * @param quoterAddress - V4 Quoter contract address
 * @returns Pool quote result
 */
export async function getPoolQuote(
  inputToken: ZapToken,
  swapAmount: bigint,
  publicClient: PublicClient,
  quoterAddress: Address
): Promise<PoolQuoteResult> {
  if (swapAmount <= 0n) {
    return { amountOut: 0n, gasEstimate: 0n };
  }

  // Determine swap direction
  // USDS is token0, USDC is token1
  const zeroForOne = inputToken === 'USDS';

  // Build pool key
  const poolKey = {
    currency0: getAddress(USDS_USDC_POOL_CONFIG.token0.address),
    currency1: getAddress(USDS_USDC_POOL_CONFIG.token1.address),
    fee: USDS_USDC_POOL_CONFIG.fee,
    tickSpacing: USDS_USDC_POOL_CONFIG.tickSpacing,
    hooks: getAddress(USDS_USDC_POOL_CONFIG.hookAddress),
  };

  try {
    // Structure as QuoteExactSingleParams: ((poolKey), zeroForOne, exactAmount, hookData)
    const quoteParams = [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], // poolKey tuple
      zeroForOne,
      swapAmount,
      '0x' as `0x${string}`, // empty hookData
    ] as const;

    const result = await publicClient.readContract({
      address: quoterAddress,
      abi: V4_QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [quoteParams],
    });

    // Result is [amountOut, gasEstimate]
    const [amountOut, gasEstimate] = result as [bigint, bigint];

    return {
      amountOut,
      gasEstimate,
    };
  } catch (error) {
    console.error('[getPoolQuote] Error:', error);
    throw error;
  }
}

// =============================================================================
// ROUTE SELECTION
// =============================================================================

/**
 * Select the optimal swap route (PSM or Pool).
 *
 * Decision logic:
 * 1. If forcePoolSwap is true, use pool
 * 2. If forcePSM is true, use PSM
 * 3. Get pool quote and calculate price impact
 * 4. If price impact > threshold (0.01%), use PSM
 * 5. Otherwise, use pool swap
 *
 * @param params - Route selection parameters
 * @returns Route selection result
 */
export async function selectSwapRoute(
  params: RouteSelectionParams
): Promise<RouteSelectionResult> {
  const { inputToken, swapAmount, publicClient, forcePoolSwap, forcePSM } = params;

  // Early return for zero amount
  if (swapAmount <= 0n) {
    const psmQuote = await getPSMQuote(inputToken, 0n);
    return {
      route: { type: 'psm', priceImpact: 0, feeBps: 0 }, // PSM3 has zero fees
      outputAmount: 0n,
      priceImpact: 0,
      usedPSM: true,
      reason: 'Zero swap amount',
      psmQuote,
    };
  }

  // Get PSM quote (always, for comparison)
  const psmQuote = await getPSMQuote(inputToken, swapAmount, publicClient);

  // If PSM is not available, must use pool
  if (!psmQuote.isAvailable) {
    return selectPoolRoute(inputToken, swapAmount, publicClient, 'PSM unavailable');
  }

  // If force flags set, use accordingly
  if (forcePSM) {
    return {
      route: {
        type: 'psm',
        priceImpact: 0,
        feeBps: 0, // PSM3 has zero fees
      },
      outputAmount: psmQuote.outputAmount,
      priceImpact: 0,
      usedPSM: true,
      reason: 'Force PSM flag set',
      psmQuote,
    };
  }

  if (forcePoolSwap) {
    return selectPoolRoute(inputToken, swapAmount, publicClient, 'Force pool flag set');
  }

  // Get pool quote
  let poolQuote: PoolQuoteResult;
  try {
    // Need to get quoter address from config
    const { getQuoterAddress } = await import('@/lib/pools-config');
    poolQuote = await getPoolQuote(inputToken, swapAmount, publicClient, getQuoterAddress());
  } catch (error) {
    // If pool quote fails, use PSM
    console.warn('[selectSwapRoute] Pool quote failed, using PSM:', error);
    return {
      route: {
        type: 'psm',
        priceImpact: 0,
        feeBps: 0, // PSM3 has zero fees
      },
      outputAmount: psmQuote.outputAmount,
      priceImpact: 0,
      usedPSM: true,
      reason: 'Pool quote failed',
      psmQuote,
    };
  }

  // Calculate price impact of pool swap
  const inputDecimals = inputToken === 'USDS' ? 18 : 6;
  const outputDecimals = inputToken === 'USDS' ? 6 : 18;
  const poolPriceImpact = calculatePriceImpact(
    swapAmount,
    poolQuote.amountOut,
    inputDecimals,
    outputDecimals
  );

  // Analyze price impact
  const analysis = analyzePriceImpact(poolPriceImpact);

  // Select route based on analysis:
  // - Default to pool swap for low price impact
  // - Use PSM as fallback when price impact exceeds threshold (0.01%)
  if (analysis.shouldUsePSM) {
    return {
      route: {
        type: 'psm',
        priceImpact: 0,
        feeBps: 0, // PSM3 has zero fees
      },
      outputAmount: psmQuote.outputAmount,
      priceImpact: poolPriceImpact,
      usedPSM: true,
      reason: analysis.message,
      psmQuote,
      poolQuote,
    };
  }

  // Use pool swap (default for low price impact)
  return {
    route: {
      type: 'pool',
      priceImpact: poolPriceImpact,
      feeBps: poolQuote.dynamicFeeBps ?? 0,
      sqrtPriceX96: 0n, // Would need to fetch from state view
    },
    outputAmount: poolQuote.amountOut,
    priceImpact: poolPriceImpact,
    usedPSM: false,
    reason: 'Low price impact, using pool',
    psmQuote,
    poolQuote,
  };
}

/**
 * Helper to select pool route.
 */
async function selectPoolRoute(
  inputToken: ZapToken,
  swapAmount: bigint,
  publicClient: PublicClient,
  reason: string
): Promise<RouteSelectionResult> {
  const { getQuoterAddress } = await import('@/lib/pools-config');
  const poolQuote = await getPoolQuote(inputToken, swapAmount, publicClient, getQuoterAddress());

  const inputDecimals = inputToken === 'USDS' ? 18 : 6;
  const outputDecimals = inputToken === 'USDS' ? 6 : 18;
  const priceImpact = calculatePriceImpact(
    swapAmount,
    poolQuote.amountOut,
    inputDecimals,
    outputDecimals
  );

  return {
    route: {
      type: 'pool',
      priceImpact,
      feeBps: poolQuote.dynamicFeeBps ?? 0,
      sqrtPriceX96: 0n,
    },
    outputAmount: poolQuote.amountOut,
    priceImpact,
    usedPSM: false,
    reason,
    poolQuote,
  };
}

// =============================================================================
// ROUTE COMPARISON
// =============================================================================

/**
 * Compare PSM and Pool routes to show user the difference.
 *
 * @param psmQuote - PSM quote
 * @param poolQuote - Pool quote
 * @param inputToken - Input token
 * @param swapAmount - Swap amount
 * @returns Comparison info
 */
export function compareRoutes(
  psmQuote: PSMQuoteResult,
  poolQuote: PoolQuoteResult,
  inputToken: ZapToken,
  swapAmount: bigint
): {
  psmBetter: boolean;
  difference: bigint;
  differencePercent: number;
} {
  const psmOutput = psmQuote.outputAmount;
  const poolOutput = poolQuote.amountOut;

  const psmBetter = psmOutput >= poolOutput;
  const difference = psmBetter ? psmOutput - poolOutput : poolOutput - psmOutput;

  // Calculate percentage difference
  const baseOutput = psmBetter ? poolOutput : psmOutput;
  const differencePercent = baseOutput > 0n ? (Number(difference) / Number(baseOutput)) * 100 : 0;

  return {
    psmBetter,
    difference,
    differencePercent,
  };
}
