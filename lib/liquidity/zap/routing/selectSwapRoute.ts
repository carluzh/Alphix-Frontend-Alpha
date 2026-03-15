/**
 * Swap Route Selector
 *
 * Determines the optimal swap route based on price impact:
 * - USDS/USDC: pool swap or PSM (1:1 swap) fallback
 * - ETH/USDC: pool swap or Kyberswap aggregator fallback
 */

import { type PublicClient, type Address, getAddress, parseAbi } from 'viem';
import { getPSMQuote, type PSMQuoteResult } from './psmQuoter';
import { calculatePriceImpact, calculatePriceImpactFromMidPrice, analyzePriceImpact } from '../calculation';
import { PSM_CONFIG, USDS_USDC_POOL_CONFIG, type ZapPoolConfig } from '../constants';
import type { ZapToken, RouteDetails, PSMRouteDetails, PoolRouteDetails, KyberswapRouteDetails } from '../types';
import { ZapError, ZapErrorCode } from '../types';
import { getKyberswapQuote } from '@/lib/aggregators/kyberswap';
import type { AggregatorQuote } from '@/lib/aggregators/types';

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
  /** Pool configuration (determines fallback route type) */
  poolConfig?: ZapPoolConfig;
  /** Optional: skip PSM and force pool swap */
  forcePoolSwap?: boolean;
  /** Optional: skip pool and force PSM */
  forcePSM?: boolean;
  /** User address (required for Kyberswap build) */
  userAddress?: Address;
  /** Slippage tolerance in basis points (for Kyberswap) */
  slippageBps?: number;
  /** Network mode for chain-specific routing (Kyberswap chain slug) */
  networkMode?: import('@/lib/network-mode').NetworkMode;
}

export interface RouteSelectionResult {
  /** Selected route details */
  route: RouteDetails;
  /** Output amount from the swap */
  outputAmount: bigint;
  /** Price impact as percentage */
  priceImpact: number;
  /** Whether a fallback route was selected (PSM or Kyberswap) */
  usedFallback: boolean;
  /** Reason for route selection */
  reason: string;
  /** Pool quote (if fetched) */
  poolQuote?: PoolQuoteResult;
  /** PSM quote (if fetched) */
  psmQuote?: PSMQuoteResult;
  /** Kyberswap quote (if fetched) */
  kyberswapQuote?: AggregatorQuote;
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
 * @param poolConfig - Optional pool config (defaults to USDS/USDC)
 * @returns Pool quote result
 */
export async function getPoolQuote(
  inputToken: ZapToken,
  swapAmount: bigint,
  publicClient: PublicClient,
  quoterAddress: Address,
  poolConfig?: ZapPoolConfig
): Promise<PoolQuoteResult> {
  if (swapAmount <= 0n) {
    return { amountOut: 0n, gasEstimate: 0n };
  }

  const config = poolConfig ?? USDS_USDC_POOL_CONFIG;

  // Determine swap direction: token0 → token1 = zeroForOne
  const zeroForOne = inputToken === config.token0.symbol;

  // Build pool key
  const poolKey = {
    currency0: getAddress(config.token0.address),
    currency1: getAddress(config.token1.address),
    fee: config.fee,
    tickSpacing: config.tickSpacing,
    hooks: getAddress(config.hookAddress),
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
    // Map known quoter revert signatures to user-friendly errors
    const errorStr = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (
      errorStr.includes('0x6190b2b0') ||
      errorStr.includes('0x486aa307') ||
      errorStr.includes('call_exception') ||
      errorStr.includes('call revert exception')
    ) {
      throw new ZapError(
        ZapErrorCode.POOL_LIQUIDITY_LOW,
        'Not enough liquidity in the pool for this amount. Try a smaller amount.',
      );
    }
    console.error('[getPoolQuote] Error:', error);
    throw error;
  }
}

// =============================================================================
// ROUTE SELECTION
// =============================================================================

/**
 * Select the optimal swap route.
 *
 * For pegged pools (USDS/USDC):
 * 1. Get pool quote and calculate price impact
 * 2. If price impact > 0.01%, use PSM (1:1 swap)
 * 3. Otherwise, use pool swap
 *
 * For non-pegged pools (ETH/USDC):
 * 1. Get pool quote and calculate price impact
 * 2. If price impact > 0.5%, use Kyberswap aggregator
 * 3. Otherwise, use pool swap
 *
 * @param params - Route selection parameters
 * @returns Route selection result
 */
export async function selectSwapRoute(
  params: RouteSelectionParams
): Promise<RouteSelectionResult> {
  const { inputToken, swapAmount, publicClient, poolConfig, forcePoolSwap, forcePSM, userAddress, slippageBps, networkMode } = params;

  // PSM path is ONLY for pools that explicitly use PSM as fallback (USDS/USDC on Base).
  // All other pools (pegged or not) use the kyberswap-fallback path.
  const usesPSM = poolConfig?.fallbackRoute === 'psm';

  if (!usesPSM && poolConfig) {
    return selectSwapRouteNonPegged(params, poolConfig);
  }

  // --- PSM-backed pegged pool (USDS/USDC) logic below ---

  // Early return for zero amount
  if (swapAmount <= 0n) {
    const psmQuote = await getPSMQuote(inputToken, 0n);
    return {
      route: { type: 'psm', priceImpact: 0, feeBps: 0 },
      outputAmount: 0n,
      priceImpact: 0,
      usedFallback: true,
      reason: 'Zero swap amount',
      psmQuote,
    };
  }

  // Get PSM quote (always, for comparison)
  const psmQuote = await getPSMQuote(inputToken, swapAmount, publicClient);

  // If PSM is not available, must use pool
  if (!psmQuote.isAvailable) {
    return selectPoolRoute(inputToken, swapAmount, publicClient, 'PSM unavailable', poolConfig, networkMode);
  }

  // If force flags set, use accordingly
  if (forcePSM) {
    return {
      route: { type: 'psm', priceImpact: 0, feeBps: 0 },
      outputAmount: psmQuote.outputAmount,
      priceImpact: 0,
      usedFallback: true,
      reason: 'Force PSM flag set',
      psmQuote,
    };
  }

  if (forcePoolSwap) {
    return selectPoolRoute(inputToken, swapAmount, publicClient, 'Force pool flag set', poolConfig, networkMode);
  }

  // Get pool quote
  let poolQuote: PoolQuoteResult;
  try {
    const { getQuoterAddress } = await import('@/lib/pools-config');
    poolQuote = await getPoolQuote(inputToken, swapAmount, publicClient, getQuoterAddress(networkMode), poolConfig);
  } catch (error) {
    console.warn('[selectSwapRoute] Pool quote failed, using PSM:', error);
    return {
      route: { type: 'psm', priceImpact: 0, feeBps: 0 },
      outputAmount: psmQuote.outputAmount,
      priceImpact: 0,
      usedFallback: true,
      reason: 'Pool quote failed',
      psmQuote,
    };
  }

  // Calculate price impact of pool swap (stablecoin: input ≈ output in USD terms)
  const config = poolConfig ?? USDS_USDC_POOL_CONFIG;
  const inputDecimals = inputToken === config.token0.symbol ? config.token0.decimals : config.token1.decimals;
  const outputDecimals = inputToken === config.token0.symbol ? config.token1.decimals : config.token0.decimals;
  const poolPriceImpact = calculatePriceImpact(
    swapAmount,
    poolQuote.amountOut,
    inputDecimals,
    outputDecimals
  );

  // Analyze price impact
  const threshold = poolConfig?.priceImpactThreshold;
  const analysis = analyzePriceImpact(poolPriceImpact, threshold, 'PSM');

  if (analysis.shouldUseFallback) {
    return {
      route: { type: 'psm', priceImpact: 0, feeBps: 0 },
      outputAmount: psmQuote.outputAmount,
      priceImpact: poolPriceImpact,
      usedFallback: true,
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
      sqrtPriceX96: 0n,
    },
    outputAmount: poolQuote.amountOut,
    priceImpact: poolPriceImpact,
    usedFallback: false,
    reason: 'Low price impact, using pool',
    psmQuote,
    poolQuote,
  };
}

/**
 * Get pool spot price via a small reference quote (outputWei/inputWei ratio).
 * Used for price impact calculation in non-pegged pairs (ETH/USDC).
 */
export async function getPoolMidPrice(
  inputToken: ZapToken,
  publicClient: PublicClient,
  poolConfig: ZapPoolConfig,
  networkMode?: import('@/lib/network-mode').NetworkMode
): Promise<number> {
  const isToken0Input = inputToken === poolConfig.token0.symbol;
  const inputDecimals = isToken0Input ? poolConfig.token0.decimals : poolConfig.token1.decimals;

  // 0.01 units of input token — small enough to approximate spot price
  const referenceAmount = BigInt(10 ** Math.max(inputDecimals - 2, 0));

  try {
    const { getQuoterAddress } = await import('@/lib/pools-config');
    const refQuote = await getPoolQuote(inputToken, referenceAmount, publicClient, getQuoterAddress(networkMode), poolConfig);
    if (refQuote.amountOut <= 0n) return 0;
    return Number(refQuote.amountOut) / Number(referenceAmount);
  } catch (error) {
    console.warn('[getPoolMidPrice] Failed:', error);
    return 0;
  }
}

/**
 * Select swap route for non-pegged pools (ETH/USDC).
 * Uses Kyberswap as fallback instead of PSM.
 */
async function selectSwapRouteNonPegged(
  params: RouteSelectionParams,
  poolConfig: ZapPoolConfig
): Promise<RouteSelectionResult> {
  const { inputToken, swapAmount, publicClient, forcePoolSwap, userAddress, slippageBps, networkMode } = params;

  if (swapAmount <= 0n) {
    return {
      route: { type: 'pool', priceImpact: 0, feeBps: 0, sqrtPriceX96: 0n },
      outputAmount: 0n,
      priceImpact: 0,
      usedFallback: false,
        reason: 'Zero swap amount',
    };
  }

  if (forcePoolSwap) {
    return selectPoolRoute(inputToken, swapAmount, publicClient, 'Force pool flag set', poolConfig, networkMode);
  }

  // Get pool quote and mid-price
  let poolQuote: PoolQuoteResult;
  try {
    const { getQuoterAddress } = await import('@/lib/pools-config');
    poolQuote = await getPoolQuote(inputToken, swapAmount, publicClient, getQuoterAddress(networkMode), poolConfig);
  } catch (error) {
    console.warn('[selectSwapRoute] Pool quote failed for non-pegged pool, trying Kyberswap:', error);
    return selectKyberswapRoute(inputToken, swapAmount, poolConfig, userAddress, slippageBps, 'Pool quote failed', undefined, undefined, networkMode);
  }

  const midPrice = await getPoolMidPrice(inputToken, publicClient, poolConfig, networkMode);

  let poolPriceImpact: number;
  if (midPrice > 0) {
    poolPriceImpact = calculatePriceImpactFromMidPrice(swapAmount, poolQuote.amountOut, midPrice);
  } else {
    console.warn('[selectSwapRouteNonPegged] Mid-price unavailable, defaulting to Kyberswap');
    return selectKyberswapRoute(inputToken, swapAmount, poolConfig, userAddress, slippageBps, 'Mid-price unavailable', poolQuote, undefined, networkMode);
  }

  console.log('[selectSwapRouteNonPegged] Price impact:', {
    swapAmount: swapAmount.toString(),
    poolAmountOut: poolQuote.amountOut.toString(),
    midPrice,
    poolPriceImpact: poolPriceImpact.toFixed(4) + '%',
    threshold: poolConfig.priceImpactThreshold + '%',
  });

  const analysis = analyzePriceImpact(poolPriceImpact, poolConfig.priceImpactThreshold, 'Kyberswap');

  if (analysis.shouldUseFallback) {
    return selectKyberswapRoute(inputToken, swapAmount, poolConfig, userAddress, slippageBps, analysis.message, poolQuote, poolPriceImpact, networkMode);
  }

  // Use pool swap
  return {
    route: {
      type: 'pool',
      priceImpact: poolPriceImpact,
      feeBps: poolQuote.dynamicFeeBps ?? 0,
      sqrtPriceX96: 0n,
    },
    outputAmount: poolQuote.amountOut,
    priceImpact: poolPriceImpact,
    usedFallback: false,
    reason: 'Low price impact, using pool',
    poolQuote,
  };
}

/**
 * Get a Kyberswap quote and build a route selection result.
 */
async function selectKyberswapRoute(
  inputToken: ZapToken,
  swapAmount: bigint,
  poolConfig: ZapPoolConfig,
  userAddress?: Address,
  slippageBps?: number,
  reason?: string,
  poolQuote?: PoolQuoteResult,
  poolPriceImpact?: number,
  networkMode?: import('@/lib/network-mode').NetworkMode,
): Promise<RouteSelectionResult> {
  const isToken0Input = inputToken === poolConfig.token0.symbol;
  const fromToken = isToken0Input ? poolConfig.token0 : poolConfig.token1;
  const toToken = isToken0Input ? poolConfig.token1 : poolConfig.token0;

  const kyberQuote = await getKyberswapQuote({
    fromTokenAddress: fromToken.address,
    toTokenAddress: toToken.address,
    amount: swapAmount.toString(),
    fromTokenDecimals: fromToken.decimals,
    toTokenDecimals: toToken.decimals,
    isExactIn: true,
    slippageBps: slippageBps ?? 50,
    userAddress,
    networkMode,
  });

  if (!kyberQuote) {
    if (poolQuote) {
      const actualImpact = poolPriceImpact ?? 0;
      console.warn(`[selectKyberswapRoute] Kyberswap unavailable, falling back to pool (impact: ${actualImpact.toFixed(4)}%)`);
      return {
        route: {
          type: 'pool',
          priceImpact: actualImpact,
          feeBps: poolQuote.dynamicFeeBps ?? 0,
          sqrtPriceX96: 0n,
        },
        outputAmount: poolQuote.amountOut,
        priceImpact: actualImpact,
        usedFallback: false,
            reason: `Kyberswap unavailable, using pool (impact: ${actualImpact.toFixed(2)}%)`,
        poolQuote,
      };
    }
    throw new Error('Both pool quote and Kyberswap quote failed');
  }

  const kyberRoute: KyberswapRouteDetails = {
    type: 'kyberswap',
    priceImpact: kyberQuote.priceImpact ?? 0,
    outputAmount: kyberQuote.outputAmountWei,
  };

  return {
    route: kyberRoute,
    outputAmount: kyberQuote.outputAmountWei,
    priceImpact: kyberQuote.priceImpact ?? 0,
    usedFallback: true,
    reason: reason ?? 'Using Kyberswap aggregator',
    poolQuote,
    kyberswapQuote: kyberQuote,
  };
}

/**
 * Helper to select pool route.
 */
async function selectPoolRoute(
  inputToken: ZapToken,
  swapAmount: bigint,
  publicClient: PublicClient,
  reason: string,
  poolConfig?: ZapPoolConfig,
  networkMode?: import('@/lib/network-mode').NetworkMode,
): Promise<RouteSelectionResult> {
  const { getQuoterAddress } = await import('@/lib/pools-config');
  const poolQuote = await getPoolQuote(inputToken, swapAmount, publicClient, getQuoterAddress(networkMode), poolConfig);

  const config = poolConfig ?? USDS_USDC_POOL_CONFIG;
  const inputDecimals = inputToken === config.token0.symbol ? config.token0.decimals : config.token1.decimals;
  const outputDecimals = inputToken === config.token0.symbol ? config.token1.decimals : config.token0.decimals;
  const priceImpact = calculatePriceImpact(swapAmount, poolQuote.amountOut, inputDecimals, outputDecimals);

  return {
    route: {
      type: 'pool',
      priceImpact,
      feeBps: poolQuote.dynamicFeeBps ?? 0,
      sqrtPriceX96: 0n,
    },
    outputAmount: poolQuote.amountOut,
    priceImpact,
    usedFallback: false,
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
