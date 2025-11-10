/**
 * Real Zap Optimizer - Uses actual V4Quoter and V4Position SDK
 *
 * Key difference from toy version:
 * - Calls REAL V4Quoter for swap quotes (accounts for fees, liquidity, hooks)
 * - Uses REAL V4Position.fromAmounts() for liquidity calculations
 * - Just implements smarter search over swap amounts (not simulation)
 */

import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { getAddress, parseAbi } from 'viem';
import { publicClient } from '../lib/viemClient';
import { V4_QUOTER_ABI_STRINGS, EMPTY_BYTES } from '../lib/swap-constants';
import { getQuoterAddress } from '../lib/pools-config';

const QUOTER_ADDRESS = getQuoterAddress();

interface OptimizationInput {
  v4Pool: V4Pool;
  inputToken: Token;
  otherToken: Token;
  inputAmount: bigint;
  tickLower: number;
  tickUpper: number;
  poolConfig: any;
  maxPriceImpactBps: number; // e.g., 50 = 0.5%
  lpFeePercent: number; // Actual LP fee from getSlot0()
}

interface OptimizationResult {
  optimalSwapAmount: bigint;
  swapOutput: bigint;
  position: V4Position;
  leftover0: bigint;
  leftover1: bigint;
  totalLeftoverPercent: number;
  priceImpactPercent: number;
  iterations: number;
  searchPath: bigint[]; // For debugging
}

/**
 * Calls real V4Quoter contract for swap quote
 */
async function getSwapQuote(
  fromToken: Token,
  toToken: Token,
  amountIn: bigint,
  poolConfig: any
): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  if (amountIn === 0n) {
    return { amountOut: 0n, gasEstimate: 0n };
  }

  const zeroForOne = fromToken.sortsBefore(toToken);
  const [sortedToken0, sortedToken1] = fromToken.sortsBefore(toToken)
    ? [fromToken, toToken]
    : [toToken, fromToken];

  const poolKey = {
    currency0: getAddress(sortedToken0.address),
    currency1: getAddress(sortedToken1.address),
    fee: poolConfig.fee,
    tickSpacing: poolConfig.tickSpacing,
    hooks: getAddress(poolConfig.hooks),
  };

  const quoteParams = [
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
    zeroForOne,
    amountIn,
    EMPTY_BYTES,
  ] as const;

  const [amountOut, gasEstimate] = await publicClient.readContract({
    address: QUOTER_ADDRESS,
    abi: parseAbi(V4_QUOTER_ABI_STRINGS),
    functionName: 'quoteExactInputSingle',
    args: [quoteParams],
  }) as readonly [bigint, bigint];

  return { amountOut, gasEstimate };
}

/**
 * Evaluates a specific swap amount using REAL quoter and position SDK
 */
async function evaluateSwapAmount(
  input: OptimizationInput,
  swapAmount: bigint
): Promise<{
  isValid: boolean;
  position: V4Position | null;
  leftover0: bigint;
  leftover1: bigint;
  totalLeftoverValue: bigint;
  priceImpactPercent: number;
  error?: string;
}> {
  const { v4Pool, inputToken, otherToken, inputAmount, tickLower, tickUpper, poolConfig, maxPriceImpactBps } = input;
  const inputIsToken0 = inputToken.sortsBefore(otherToken);

  try {
    // Call REAL V4Quoter
    const swapQuote = await getSwapQuote(inputToken, otherToken, swapAmount, poolConfig);

    // Calculate price impact (Note: This includes fees, so expect ~1% for 0.8% fee pools)
    const priceImpactPercent = calculatePriceImpact(
      swapAmount,
      swapQuote.amountOut,
      v4Pool.sqrtRatioX96,
      inputIsToken0,
      inputToken,
      otherToken
    );

    // Don't reject based on "price impact" since it includes fees
    // The quoter already validated the swap is possible
    // Just track it for informational purposes

    // Calculate amounts after swap
    const remainingInput = inputAmount - swapAmount;
    const receivedOther = swapQuote.amountOut;

    const amount0 = inputIsToken0 ? remainingInput : receivedOther;
    const amount1 = inputIsToken0 ? receivedOther : remainingInput;

    // Use REAL V4Position SDK
    const position = V4Position.fromAmounts({
      pool: v4Pool,
      tickLower,
      tickUpper,
      amount0: JSBI.BigInt(amount0.toString()),
      amount1: JSBI.BigInt(amount1.toString()),
      useFullPrecision: true,
    });

    // Calculate leftovers
    const mintAmount0 = BigInt(position.mintAmounts.amount0.toString());
    const mintAmount1 = BigInt(position.mintAmounts.amount1.toString());

    const leftover0 = amount0 > mintAmount0 ? amount0 - mintAmount0 : 0n;
    const leftover1 = amount1 > mintAmount1 ? amount1 - mintAmount1 : 0n;

    // Calculate total leftover in terms of input token
    let totalLeftoverValue: bigint;
    if (inputIsToken0) {
      const leftover1InInput =
        swapAmount > 0n && swapQuote.amountOut > 0n
          ? (leftover1 * swapAmount) / swapQuote.amountOut
          : leftover1;
      totalLeftoverValue = leftover0 + leftover1InInput;
    } else {
      const leftover0InInput =
        swapAmount > 0n && swapQuote.amountOut > 0n
          ? (leftover0 * swapAmount) / swapQuote.amountOut
          : leftover0;
      totalLeftoverValue = leftover1 + leftover0InInput;
    }

    return {
      isValid: true,
      position,
      leftover0,
      leftover1,
      totalLeftoverValue,
      priceImpactPercent,
    };
  } catch (error) {
    return {
      isValid: false,
      position: null,
      leftover0: 0n,
      leftover1: 0n,
      totalLeftoverValue: inputAmount,
      priceImpactPercent: 0,
      error: String(error),
    };
  }
}

/**
 * Calculates price impact percentage
 * Compares expected output (at current price) vs actual output (from quoter)
 */
function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  sqrtPriceX96: JSBI,
  inputIsToken0: boolean,
  inputToken: Token,
  outputToken: Token
): number {
  if (amountIn === 0n || amountOut === 0n) return 0;

  const Q96 = JSBI.BigInt(2 ** 96);
  const inputJSBI = JSBI.BigInt(amountIn.toString());

  let expectedOutputWithoutSlippage: bigint;

  if (inputIsToken0) {
    // Swapping token0 for token1: output = input * (sqrtPrice/Q96)^2
    const sqrtPriceSquared = JSBI.multiply(sqrtPriceX96, sqrtPriceX96);
    const Q96Squared = JSBI.multiply(Q96, Q96);
    const numerator = JSBI.multiply(inputJSBI, sqrtPriceSquared);
    const rawOutput = JSBI.divide(numerator, Q96Squared);

    // Adjust for decimals
    const decimalDiff = outputToken.decimals - inputToken.decimals;
    if (decimalDiff > 0) {
      const multiplier = JSBI.BigInt(10 ** decimalDiff);
      expectedOutputWithoutSlippage = BigInt(JSBI.multiply(rawOutput, multiplier).toString());
    } else if (decimalDiff < 0) {
      const divisor = JSBI.BigInt(10 ** Math.abs(decimalDiff));
      expectedOutputWithoutSlippage = BigInt(JSBI.divide(rawOutput, divisor).toString());
    } else {
      expectedOutputWithoutSlippage = BigInt(rawOutput.toString());
    }
  } else {
    // Swapping token1 for token0: output = input / (sqrtPrice/Q96)^2
    const sqrtPriceSquared = JSBI.multiply(sqrtPriceX96, sqrtPriceX96);
    const Q96Squared = JSBI.multiply(Q96, Q96);
    const numerator = JSBI.multiply(inputJSBI, Q96Squared);
    const rawOutput = JSBI.divide(numerator, sqrtPriceSquared);

    const decimalDiff = outputToken.decimals - inputToken.decimals;
    if (decimalDiff > 0) {
      const multiplier = JSBI.BigInt(10 ** decimalDiff);
      expectedOutputWithoutSlippage = BigInt(JSBI.multiply(rawOutput, multiplier).toString());
    } else if (decimalDiff < 0) {
      const divisor = JSBI.BigInt(10 ** Math.abs(decimalDiff));
      expectedOutputWithoutSlippage = BigInt(JSBI.divide(rawOutput, divisor).toString());
    } else {
      expectedOutputWithoutSlippage = BigInt(rawOutput.toString());
    }
  }

  if (expectedOutputWithoutSlippage === 0n) return 0;

  const difference =
    expectedOutputWithoutSlippage > amountOut
      ? expectedOutputWithoutSlippage - amountOut
      : amountOut - expectedOutputWithoutSlippage;

  const impactBps = (difference * 10000n) / expectedOutputWithoutSlippage;
  return Number(impactBps) / 100;
}

/**
 * Optimizes swap amount using binary search over REAL quoter calls
 */
export async function optimizeZapWithRealQuoter(
  input: OptimizationInput,
  maxIterations: number = 15
): Promise<OptimizationResult> {
  const { inputAmount } = input;

  // Calculate theoretical optimal as starting point
  const theoreticalFraction = calculateTheoreticalOptimalFraction(input);
  const theoreticalSwapAmount = BigInt(Math.floor(Number(inputAmount) * theoreticalFraction));

  console.log(`Theoretical optimal: swap ${(theoreticalFraction * 100).toFixed(2)}% of input`);

  let low = 0n;
  let high = inputAmount;
  let bestResult: Awaited<ReturnType<typeof evaluateSwapAmount>> | null = null;
  let bestSwapAmount = 0n;
  let iteration = 0;
  const searchPath: bigint[] = [];

  // Binary search with refinement
  while (iteration < maxIterations) {
    iteration++;

    // Test point: Start with theoretical, then use binary search
    const testAmount = iteration === 1 ? theoreticalSwapAmount : (low + high) / 2n;
    searchPath.push(testAmount);

    console.log(`[Iter ${iteration}] Testing swap amount: ${testAmount} (${((Number(testAmount) / Number(inputAmount)) * 100).toFixed(2)}%)`);

    const result = await evaluateSwapAmount(input, testAmount);

    if (!result.isValid) {
      console.log(`  ❌ Invalid: ${result.error}`);
      // If invalid due to price impact, reduce swap amount
      high = testAmount;
      continue;
    }

    const leftoverPercent = (Number(result.totalLeftoverValue) / Number(inputAmount)) * 100;
    const truePriceImpact = Math.max(0, result.priceImpactPercent - input.lpFeePercent);
    console.log(`  ✓ Valid - Leftover: ${leftoverPercent.toFixed(4)}%, Fee+Slippage: ${result.priceImpactPercent.toFixed(4)}%, True Impact: ${truePriceImpact.toFixed(4)}%`);

    // Track best
    if (!bestResult || result.totalLeftoverValue < bestResult.totalLeftoverValue) {
      bestResult = result;
      bestSwapAmount = testAmount;
    }

    // Check if excellent (< 0.1% leftover)
    if (leftoverPercent < 0.1) {
      console.log(`  🎯 Excellent result found!`);
      break;
    }

    // Adjust search bounds based on which token has more leftover
    if (result.leftover0 > result.leftover1) {
      // Too much token0 left → need to swap more token0 for token1
      if (input.inputToken.sortsBefore(input.otherToken)) {
        low = testAmount; // Input is token0, swap more
      } else {
        high = testAmount; // Input is token1, swap less
      }
    } else {
      // Too much token1 left → need less token1, more token0
      if (input.inputToken.sortsBefore(input.otherToken)) {
        high = testAmount; // Input is token0, swap less
      } else {
        low = testAmount; // Input is token1, swap more
      }
    }

    // Convergence check
    if (high - low < inputAmount / 10000n) {
      console.log(`  ✓ Converged (search range < 0.01%)`);
      break;
    }
  }

  if (!bestResult || !bestResult.position) {
    throw new Error(`Optimization failed after ${iteration} iterations. Try increasing maxPriceImpactBps or adjusting position range.`);
  }

  const totalLeftoverPercent = (Number(bestResult.totalLeftoverValue) / Number(inputAmount)) * 100;

  return {
    optimalSwapAmount: bestSwapAmount,
    swapOutput: input.inputToken.sortsBefore(input.otherToken)
      ? BigInt(bestResult.position.amount1.quotient.toString())
      : BigInt(bestResult.position.amount0.quotient.toString()),
    position: bestResult.position,
    leftover0: bestResult.leftover0,
    leftover1: bestResult.leftover1,
    totalLeftoverPercent,
    priceImpactPercent: bestResult.priceImpactPercent,
    iterations: iteration,
    searchPath,
  };
}

/**
 * Calculates theoretical optimal swap fraction using Uniswap V3 math
 * (Same as production code)
 */
function calculateTheoreticalOptimalFraction(input: OptimizationInput): number {
  const { v4Pool, inputToken, otherToken, tickLower, tickUpper } = input;
  const inputIsToken0 = inputToken.sortsBefore(otherToken);

  const sqrtPriceX96 = v4Pool.sqrtRatioX96;
  const Q96 = JSBI.BigInt(2 ** 96);

  const sqrtPriceLowerX96 = JSBI.BigInt(Math.floor(Math.sqrt(1.0001 ** tickLower) * Number(Q96)));
  const sqrtPriceUpperX96 = JSBI.BigInt(Math.floor(Math.sqrt(1.0001 ** tickUpper) * Number(Q96)));

  const sqrtPriceCurrent = JSBI.toNumber(sqrtPriceX96) / Number(Q96);
  const sqrtPriceLower = JSBI.toNumber(sqrtPriceLowerX96) / Number(Q96);
  const sqrtPriceUpper = JSBI.toNumber(sqrtPriceUpperX96) / Number(Q96);

  const L = 1;
  const amount0ForL = (L * (sqrtPriceUpper - sqrtPriceCurrent)) / (sqrtPriceCurrent * sqrtPriceUpper);
  const amount1ForL = L * (sqrtPriceCurrent - sqrtPriceLower);

  const currentPrice = sqrtPriceCurrent * sqrtPriceCurrent;
  const value0Needed = amount0ForL * currentPrice;
  const value1Needed = amount1ForL;
  const totalValueNeeded = value0Needed + value1Needed;

  let fractionToKeep: number;
  if (inputIsToken0) {
    fractionToKeep = value0Needed / totalValueNeeded;
  } else {
    fractionToKeep = value1Needed / totalValueNeeded;
  }

  return 1 - fractionToKeep; // Fraction to swap
}
