/**
 * Binary Search Swap Calculator
 *
 * Finds the optimal swap amount for Zap deposits using binary search
 * with actual Hook preview functions. This ensures leftover (dust)
 * is minimized to < 0.01% of input value.
 */

import { type PublicClient, type Address, formatUnits, parseUnits } from 'viem';
import { selectSwapRoute, getPoolQuote, getPoolMidPrice } from '../routing/selectSwapRoute';
import { calculatePriceImpactFromMidPrice } from './calculatePriceImpact';
import {
  previewAddFromAmount0,
  previewAddFromAmount1,
} from '../../unified-yield/buildUnifiedYieldDepositTx';
import { type ZapToken, type RouteDetails, ZapError } from '../types';
import type { ZapPoolConfig } from '../constants';
import { chainIdForMode } from '@/lib/network-mode';

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
  /** Pool configuration (for decimals, routing, etc.) */
  poolConfig?: ZapPoolConfig;
  /** User address (required for Kyberswap routing) */
  userAddress?: Address;
  /** Slippage tolerance in basis points */
  slippageBps?: number;
  /** Max binary search iterations (default: 20) */
  maxIterations?: number;
  /** Network mode for chain-specific routing (e.g., Kyberswap chain slug) */
  networkMode?: import('@/lib/network-mode').NetworkMode;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CONVERGENCE_THRESHOLD_DIVISOR = 10000n;
const MIN_REDUCTION_BPS = 1n;
const DEFAULT_DECIMAL_FACTOR = 10n ** 12n;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Binary search to find optimal swap amount for Zap.
 *
 * Flow:
 * 1. Decide route once: quote pool with half the input, check price impact
 *    - Impact OK → use pool for all iterations
 *    - Impact too high → use Kyberswap for all iterations
 * 2. Binary search: for each candidate amount, quote the chosen route
 *    and compare output to what the Hook needs for the deposit
 * 3. Converge when bounds are within 0.01% of input
 */
export async function findOptimalSwapAmount(
  params: FindOptimalSwapParams
): Promise<OptimalSwapResult> {
  const {
    inputToken,
    inputAmount,
    hookAddress,
    publicClient,
    poolConfig,
    userAddress,
    slippageBps,
    maxIterations = 20,
    networkMode,
  } = params;

  const isInputToken1 = poolConfig
    ? inputToken === poolConfig.token1.symbol
    : inputToken === 'USDC';

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

  const convergenceThreshold = inputAmount / CONVERGENCE_THRESHOLD_DIVISOR;

  // ---- DETERMINE ROUTE ONCE ----
  // For non-pegged pools: quote pool with half input, check price impact, decide pool vs kyberswap
  // For pegged pools: use selectSwapRoute per iteration (cheap, handles PSM decision)

  let getSwapQuote: (amount: bigint) => Promise<{ amountOut: bigint; route: RouteDetails }>;
  let midPrice = 0;

  // Route decision: pools using kyberswap fallback (ETH/USDC, USDC/USDT) get a single
  // Kyberswap quote upfront via server-side API proxy (avoids CSP issues).
  // PSM-backed pools (USDS/USDC) use selectSwapRoute per iteration (cheap, handles PSM decision).
  if (poolConfig && poolConfig.fallbackRoute !== 'psm') {
    const { getQuoterAddress } = await import('@/lib/pools-config');
    const quoterAddress = getQuoterAddress(networkMode);

    midPrice = await getPoolMidPrice(inputToken, publicClient, poolConfig, networkMode);
    const halfQuote = await getPoolQuote(inputToken, inputAmount / 2n, publicClient, quoterAddress, poolConfig);
    const halfImpact = midPrice > 0
      ? calculatePriceImpactFromMidPrice(inputAmount / 2n, halfQuote.amountOut, midPrice)
      : Infinity;

    const useKyberswap = Math.abs(halfImpact) > poolConfig.priceImpactThreshold;

    console.log('[findOptimalSwapAmount] Route decision:', {
      halfImpact: halfImpact.toFixed(4) + '%',
      threshold: poolConfig.priceImpactThreshold + '%',
      route: useKyberswap ? 'kyberswap' : 'pool',
    });

    const isToken0Input = inputToken === poolConfig.token0.symbol;
    const fromToken = isToken0Input ? poolConfig.token0 : poolConfig.token1;
    const toToken = isToken0Input ? poolConfig.token1 : poolConfig.token0;

    if (useKyberswap) {
      // Get ONE Kyberswap quote via our API to compute the rate.
      // Binary search uses this rate as linear approximation (no API calls per iteration).
      // A final real quote is fetched after convergence.
      const kyberRef = await fetchKyberQuoteViaApi(
        fromToken.address, toToken.address,
        inputAmount / 2n, fromToken.decimals, toToken.decimals,
        fromToken.symbol, toToken.symbol, slippageBps, userAddress, networkMode,
      );
      if (!kyberRef) throw new Error('Kyberswap unavailable for this pair');

      const kyberRate = Number(kyberRef) / Number(inputAmount / 2n);

      getSwapQuote = async (amount: bigint) => {
        const estimatedOutput = BigInt(Math.floor(Number(amount) * kyberRate));
        return {
          amountOut: estimatedOutput,
          route: { type: 'kyberswap' as const, priceImpact: 0, outputAmount: estimatedOutput },
        };
      };
    } else {
      getSwapQuote = async (amount: bigint) => {
        const quote = await getPoolQuote(inputToken, amount, publicClient, quoterAddress, poolConfig);
        const impact = midPrice > 0 ? calculatePriceImpactFromMidPrice(amount, quote.amountOut, midPrice) : 0;
        return {
          amountOut: quote.amountOut,
          route: { type: 'pool' as const, priceImpact: impact, feeBps: quote.dynamicFeeBps ?? 0, sqrtPriceX96: 0n },
        };
      };
    }
  } else {
    // Pegged pool (USDS/USDC): selectSwapRoute handles PSM vs pool per iteration
    getSwapQuote = async (amount: bigint) => {
      const result = await selectSwapRoute({
        inputToken,
        swapAmount: amount,
        publicClient,
        poolConfig,
        userAddress,
        slippageBps,
        networkMode,
      });
      return { amountOut: result.outputAmount, route: result.route };
    };
  }

  // ---- BINARY SEARCH ----
  let low = 0n;
  let high = inputAmount;
  let bestResult: OptimalSwapResult | null = null;

  for (let i = 0; i < maxIterations && high - low > convergenceThreshold; i++) {
    const mid = (low + high) / 2n;
    if (mid === 0n) { low = 1n; continue; }

    try {
      const { amountOut: swapOutput, route } = await getSwapQuote(mid);
      const remaining = inputAmount - mid;

      const preview = isInputToken1
        ? await previewAddFromAmount1(hookAddress, remaining, publicClient)
        : await previewAddFromAmount0(hookAddress, remaining, publicClient);

      if (!preview) {
        console.warn(`[findOptimalSwapAmount] Preview failed at iteration ${i}`);
        continue;
      }

      const required = preview.otherAmount;

      // For pool swaps, adjust required amount for price impact shifting deposit ratio
      let effectiveRequired = required;
      if (route.type === 'pool' && route.priceImpact > 0) {
        const reduction = BigInt(Math.floor(Number(required) * (route.priceImpact / 100)));
        effectiveRequired = required > reduction ? required - reduction : 0n;
      }

      const dust = swapOutput > effectiveRequired
        ? swapOutput - effectiveRequired
        : effectiveRequired - swapOutput;

      const normalizedDust = normalizeToInputDecimals(dust, inputToken, poolConfig);
      const dustPercent = Number(normalizedDust * 10000n / inputAmount) / 100;

      if (!bestResult || dustPercent < bestResult.estimatedDustPercent) {
        bestResult = {
          swapAmount: mid,
          swapOutput,
          route,
          remainingInput: remaining,
          requiredOther: effectiveRequired,
          expectedShares: preview.shares,
          estimatedDustPercent: dustPercent,
        };
      }

      if (swapOutput >= effectiveRequired) {
        high = mid;
      } else {
        low = mid;
      }
    } catch (error) {
      // Propagate known user-facing errors immediately instead of swallowing them
      if (error instanceof ZapError) throw error;
      console.warn(`[findOptimalSwapAmount] Iteration ${i} error:`, error);
      high = (low + high) / 2n;
    }
  }

  if (!bestResult) {
    throw new Error('Binary search failed to converge');
  }

  // ---- REDUCTION STEP ----
  // Apply small reduction to account for pool price shift between simulation and execution
  const impact = bestResult.route.priceImpact;
  const reductionBps = BigInt(Math.ceil(Math.max(impact * 200, Number(MIN_REDUCTION_BPS))));
  const adjustedSwapAmount = bestResult.swapAmount - (bestResult.swapAmount * reductionBps / 10000n);

  try {
    const { amountOut: adjustedOutput, route: adjustedRoute } = await getSwapQuote(adjustedSwapAmount);
    const adjustedRemaining = inputAmount - adjustedSwapAmount;

    const adjustedPreview = isInputToken1
      ? await previewAddFromAmount1(hookAddress, adjustedRemaining, publicClient)
      : await previewAddFromAmount0(hookAddress, adjustedRemaining, publicClient);

    if (adjustedPreview) {
      const adjustedDust = adjustedOutput > adjustedPreview.otherAmount
        ? adjustedOutput - adjustedPreview.otherAmount
        : adjustedPreview.otherAmount - adjustedOutput;
      const normalizedAdjustedDust = normalizeToInputDecimals(adjustedDust, inputToken, poolConfig);
      const adjustedDustPercent = Number(normalizedAdjustedDust * 10000n / inputAmount) / 100;

      bestResult = {
        swapAmount: adjustedSwapAmount,
        swapOutput: adjustedOutput,
        route: adjustedRoute,
        remainingInput: adjustedRemaining,
        requiredOther: adjustedPreview.otherAmount,
        expectedShares: adjustedPreview.shares,
        estimatedDustPercent: adjustedDustPercent,
      };
    }
  } catch {
    // Use original result
  }

  // For Kyberswap route: binary search used a linear approximation,
  // now get the real quote for the converged amount for accurate preview
  if (bestResult.route.type === 'kyberswap' && poolConfig) {
    const isToken0Input = inputToken === poolConfig.token0.symbol;
    const fromToken = isToken0Input ? poolConfig.token0 : poolConfig.token1;
    const toToken = isToken0Input ? poolConfig.token1 : poolConfig.token0;

    const realOutput = await fetchKyberQuoteViaApi(
      fromToken.address, toToken.address,
      bestResult.swapAmount, fromToken.decimals, toToken.decimals,
      fromToken.symbol, toToken.symbol, slippageBps, userAddress, networkMode,
    );
    if (realOutput) {
      bestResult.swapOutput = realOutput;
      bestResult.route = { type: 'kyberswap', priceImpact: 0, outputAmount: realOutput };
    }
  }

  console.log('[findOptimalSwapAmount] Converged:', {
    swapAmount: bestResult.swapAmount.toString(),
    swapOutput: bestResult.swapOutput.toString(),
    dustPercent: bestResult.estimatedDustPercent.toFixed(4),
    route: bestResult.route.type,
    reductionBps: Number(reductionBps),
  });

  return bestResult;
}

// =============================================================================
// HELPERS
// =============================================================================

function normalizeToInputDecimals(dust: bigint, inputToken: ZapToken, poolConfig?: ZapPoolConfig): bigint {
  if (poolConfig) {
    const isInputToken1 = inputToken === poolConfig.token1.symbol;
    const inputDecimals = isInputToken1 ? poolConfig.token1.decimals : poolConfig.token0.decimals;
    const outputDecimals = isInputToken1 ? poolConfig.token0.decimals : poolConfig.token1.decimals;
    const decimalDiff = outputDecimals - inputDecimals;

    if (decimalDiff > 0) {
      return dust / (10n ** BigInt(decimalDiff));
    } else if (decimalDiff < 0) {
      return dust * (10n ** BigInt(-decimalDiff));
    }
    return dust;
  }

  // Fallback for backward compat (USDS/USDC hardcoded)
  if (inputToken === 'USDC') {
    return dust / DEFAULT_DECIMAL_FACTOR;
  } else {
    return dust * DEFAULT_DECIMAL_FACTOR;
  }
}

/**
 * Fetch a swap quote via our server-side API route (/api/swap/get-quote).
 * The API fetches both V4 and Kyberswap quotes and returns the best.
 * This avoids CSP issues since Kyberswap is called server-side.
 */
async function fetchKyberQuoteViaApi(
  fromTokenAddress: string,
  toTokenAddress: string,
  amountWei: bigint,
  fromTokenDecimals: number,
  toTokenDecimals: number,
  fromSymbol: string,
  toSymbol: string,
  slippageBps?: number,
  userAddress?: string,
  networkMode?: import('@/lib/network-mode').NetworkMode,
): Promise<bigint | null> {
  try {
    const res = await fetch('/api/swap/get-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromTokenSymbol: fromSymbol,
        toTokenSymbol: toSymbol,
        fromTokenAddress,
        toTokenAddress,
        amountDecimalsStr: formatUnits(amountWei, fromTokenDecimals),
        fromTokenDecimals,
        toTokenDecimals,
        swapType: 'ExactIn',
        chainId: networkMode ? chainIdForMode(networkMode) : 8453,
        slippageBps: slippageBps ?? 50,
        userAddress,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || !data.toAmount) return null;
    return parseUnits(data.toAmount, toTokenDecimals);
  } catch (e) {
    console.warn('[fetchKyberQuoteViaApi] Failed:', e);
    return null;
  }
}
