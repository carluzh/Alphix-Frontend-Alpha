/**
 * Swap Route Selector
 *
 * Determines the optimal swap route based on price impact:
 * - Pool swap (Universal Router) when impact is within threshold
 * - Kyberswap aggregator fallback when impact exceeds threshold
 */

import { type PublicClient, type Address, getAddress, parseAbi } from 'viem';
import { calculatePriceImpact, calculatePriceImpactFromMidPrice, analyzePriceImpact } from '../calculation';
import { type ZapPoolConfig } from '../constants';
import type { ZapToken, RouteDetails, KyberswapRouteDetails } from '../types';
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
  /** Optional: skip aggregator and force pool swap */
  forcePoolSwap?: boolean;
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
  /** Whether a fallback route was selected (Kyberswap) */
  usedFallback: boolean;
  /** Reason for route selection */
  reason: string;
  /** Pool quote (if fetched) */
  poolQuote?: PoolQuoteResult;
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
 * @param poolConfig - Pool config (required)
 * @returns Pool quote result
 */
export async function getPoolQuote(
  inputToken: ZapToken,
  swapAmount: bigint,
  publicClient: PublicClient,
  quoterAddress: Address,
  poolConfig: ZapPoolConfig
): Promise<PoolQuoteResult> {
  if (swapAmount <= 0n) {
    return { amountOut: 0n, gasEstimate: 0n };
  }

  const config = poolConfig;

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
 * 1. Get pool quote and calculate price impact
 * 2. If price impact exceeds the pool's threshold, use Kyberswap aggregator
 * 3. Otherwise, use pool swap
 *
 * @param params - Route selection parameters
 * @returns Route selection result
 */
export async function selectSwapRoute(
  params: RouteSelectionParams
): Promise<RouteSelectionResult> {
  const { poolConfig } = params;

  if (!poolConfig) {
    throw new ZapError(
      ZapErrorCode.INVALID_INPUT,
      'selectSwapRoute requires a poolConfig'
    );
  }

  return selectSwapRouteWithKyberswapFallback(params, poolConfig);
}

/**
 * Get pool spot price via a small reference quote (outputWei/inputWei ratio).
 * Used for price impact calculation.
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
 * Select swap route, falling back to Kyberswap aggregator when pool price
 * impact exceeds the pool's configured threshold.
 */
async function selectSwapRouteWithKyberswapFallback(
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
    console.warn('[selectSwapRoute] Pool quote failed, trying Kyberswap:', error);
    return selectKyberswapRoute(inputToken, swapAmount, poolConfig, userAddress, slippageBps, 'Pool quote failed', undefined, undefined, networkMode);
  }

  const midPrice = await getPoolMidPrice(inputToken, publicClient, poolConfig, networkMode);

  let poolPriceImpact: number;
  if (midPrice > 0) {
    poolPriceImpact = calculatePriceImpactFromMidPrice(swapAmount, poolQuote.amountOut, midPrice);
  } else {
    console.warn('[selectSwapRoute] Mid-price unavailable, defaulting to Kyberswap');
    return selectKyberswapRoute(inputToken, swapAmount, poolConfig, userAddress, slippageBps, 'Mid-price unavailable', poolQuote, undefined, networkMode);
  }

  console.log('[selectSwapRoute] Price impact:', {
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
    throw new ZapError(
      ZapErrorCode.POOL_LIQUIDITY_LOW,
      'Unable to get a quote from Kyberswap or the pool. Please try again or use a smaller amount.',
    );
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
  poolConfig: ZapPoolConfig,
  networkMode?: import('@/lib/network-mode').NetworkMode,
): Promise<RouteSelectionResult> {
  const { getQuoterAddress } = await import('@/lib/pools-config');
  const poolQuote = await getPoolQuote(inputToken, swapAmount, publicClient, getQuoterAddress(networkMode), poolConfig);

  const inputDecimals = inputToken === poolConfig.token0.symbol ? poolConfig.token0.decimals : poolConfig.token1.decimals;
  const outputDecimals = inputToken === poolConfig.token0.symbol ? poolConfig.token1.decimals : poolConfig.token0.decimals;
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
