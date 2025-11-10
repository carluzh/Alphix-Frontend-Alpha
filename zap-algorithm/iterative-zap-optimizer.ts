/**
 * Iterative Zap Optimizer with Tick Simulation
 * Solves the cyclical dependency by:
 * 1. Predicting post-swap price using tick-by-tick simulation
 * 2. Calculating optimal ratio at predicted price
 * 3. Iterating until convergence
 */

import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { getAddress, parseAbi } from 'viem';
import { publicClient } from '../lib/viemClient';
import { V4_QUOTER_ABI_STRINGS, EMPTY_BYTES } from '../lib/swap-constants';
import { getQuoterAddress } from '../lib/pools-config';
import { simulateSwap } from './tick-swap-simulator';

const QUOTER_ADDRESS = getQuoterAddress();

interface OptimizationInput {
  v4Pool: V4Pool;
  inputToken: Token;
  otherToken: Token;
  inputAmount: bigint;
  tickLower: number;
  tickUpper: number;
  poolConfig: any;
  tickPositions: Array<{ tickLower: number; tickUpper: number; liquidity: string }>;
  lpFeeMillionths: number; // e.g., 10800 for 1.08%
}

interface OptimizationResult {
  optimalSwapAmount: bigint;
  swapOutput: bigint;
  position: V4Position;
  leftover0: bigint;
  leftover1: bigint;
  totalLeftoverPercent: number;
  predictedPriceImpactPercent: number;
  iterations: number;
  convergenceHistory: Array<{
    iteration: number;
    swapAmount: bigint;
    predictedSqrtPrice: string;
    leftoverPercent: number;
  }>;
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
 * Calculates theoretical optimal swap fraction at a given price
 */
function calculateOptimalFractionAtPrice(
  sqrtPriceX96: JSBI,
  tickLower: number,
  tickUpper: number,
  inputIsToken0: boolean
): number {
  const Q96 = JSBI.BigInt(2 ** 96);
  const sqrtPriceLowerX96 = JSBI.BigInt(Math.floor(Math.sqrt(1.0001 ** tickLower) * Number(Q96)));
  const sqrtPriceUpperX96 = JSBI.BigInt(Math.floor(Math.sqrt(1.0001 ** tickUpper) * Number(Q96)));

  const sqrtPriceCurrent = JSBI.toNumber(sqrtPriceX96) / Number(Q96);
  const sqrtPriceLower = JSBI.toNumber(sqrtPriceLowerX96) / Number(Q96);
  const sqrtPriceUpper = JSBI.toNumber(sqrtPriceUpperX96) / Number(Q96);

  // Calculate ratio needed for L=1
  const L = 1;
  const amount0ForL = (L * (sqrtPriceUpper - sqrtPriceCurrent)) / (sqrtPriceCurrent * sqrtPriceUpper);
  const amount1ForL = L * (sqrtPriceCurrent - sqrtPriceLower);

  const currentPrice = sqrtPriceCurrent * sqrtPriceCurrent;
  const value0Needed = amount0ForL * currentPrice;
  const value1Needed = amount1ForL;
  const totalValueNeeded = value0Needed + value1Needed;

  if (totalValueNeeded === 0) return 0;

  let fractionToKeep: number;
  if (inputIsToken0) {
    fractionToKeep = value0Needed / totalValueNeeded;
  } else {
    fractionToKeep = value1Needed / totalValueNeeded;
  }

  return Math.max(0, Math.min(1, 1 - fractionToKeep)); // Fraction to swap
}

/**
 * Evaluates a swap amount using tick simulation + real V4Position
 */
async function evaluateSwapWithSimulation(
  input: OptimizationInput,
  swapAmount: bigint
): Promise<{
  isValid: boolean;
  position: V4Position | null;
  leftover0: bigint;
  leftover1: bigint;
  totalLeftoverValue: bigint;
  predictedSqrtPriceX96: JSBI;
  error?: string;
}> {
  const { v4Pool, inputToken, otherToken, inputAmount, tickLower, tickUpper, tickPositions, lpFeeMillionths } = input;
  const inputIsToken0 = inputToken.sortsBefore(otherToken);

  try {
    // Step 1: Simulate swap to predict post-swap price
    const zeroForOne = inputIsToken0;
    const simulationResult = await simulateSwap(
      tickPositions,
      v4Pool.sqrtRatioX96,
      v4Pool.tickCurrent,
      swapAmount,
      zeroForOne,
      lpFeeMillionths
    );

    const predictedSqrtPriceX96 = simulationResult.finalSqrtPriceX96;
    const swapOutput = simulationResult.amountOut;

    // Step 2: Create V4Pool at predicted price for V4Position.fromAmounts()
    const predictedPool = new V4Pool(
      inputIsToken0 ? inputToken : otherToken,
      inputIsToken0 ? otherToken : inputToken,
      input.poolConfig.fee,
      input.poolConfig.tickSpacing,
      input.poolConfig.hooks,
      predictedSqrtPriceX96,
      v4Pool.liquidity, // Keep same total liquidity (approximation)
      simulationResult.finalTick
    );

    // Step 3: Calculate position at predicted price
    const remainingInput = inputAmount - swapAmount;
    const amount0 = inputIsToken0 ? remainingInput : swapOutput;
    const amount1 = inputIsToken0 ? swapOutput : remainingInput;

    const position = V4Position.fromAmounts({
      pool: predictedPool,
      tickLower,
      tickUpper,
      amount0: JSBI.BigInt(amount0.toString()),
      amount1: JSBI.BigInt(amount1.toString()),
      useFullPrecision: true,
    });

    // Step 4: Calculate leftovers
    const mintAmount0 = BigInt(position.mintAmounts.amount0.toString());
    const mintAmount1 = BigInt(position.mintAmounts.amount1.toString());

    const leftover0 = amount0 > mintAmount0 ? amount0 - mintAmount0 : 0n;
    const leftover1 = amount1 > mintAmount1 ? amount1 - mintAmount1 : 0n;

    // Calculate total leftover in terms of input token
    let totalLeftoverValue: bigint;
    if (inputIsToken0) {
      const leftover1InInput =
        swapAmount > 0n && swapOutput > 0n
          ? (leftover1 * swapAmount) / swapOutput
          : leftover1;
      totalLeftoverValue = leftover0 + leftover1InInput;
    } else {
      const leftover0InInput =
        swapAmount > 0n && swapOutput > 0n
          ? (leftover0 * swapAmount) / swapOutput
          : leftover0;
      totalLeftoverValue = leftover1 + leftover0InInput;
    }

    return {
      isValid: true,
      position,
      leftover0,
      leftover1,
      totalLeftoverValue,
      predictedSqrtPriceX96,
    };
  } catch (error) {
    return {
      isValid: false,
      position: null,
      leftover0: 0n,
      leftover1: 0n,
      totalLeftoverValue: inputAmount,
      predictedSqrtPriceX96: v4Pool.sqrtRatioX96,
      error: String(error),
    };
  }
}

/**
 * Optimizes zap with iterative convergence using tick simulation
 */
export async function optimizeZapIterative(
  input: OptimizationInput,
  maxIterations: number = 10,
  convergenceThreshold: number = 0.01 // Stop if change < 0.01%
): Promise<OptimizationResult> {
  const { inputAmount, v4Pool, inputToken, otherToken, tickLower, tickUpper } = input;
  const inputIsToken0 = inputToken.sortsBefore(otherToken);

  console.log('\n=== Iterative Zap Optimization with Tick Simulation ===\n');

  let currentSqrtPrice = v4Pool.sqrtRatioX96;
  let bestResult: Awaited<ReturnType<typeof evaluateSwapWithSimulation>> | null = null;
  let bestSwapAmount = 0n;
  const convergenceHistory: Array<{
    iteration: number;
    swapAmount: bigint;
    predictedSqrtPrice: string;
    leftoverPercent: number;
  }> = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Calculate optimal swap amount at current predicted price
    const optimalFraction = calculateOptimalFractionAtPrice(
      currentSqrtPrice,
      tickLower,
      tickUpper,
      inputIsToken0
    );
    const swapAmount = BigInt(Math.floor(Number(inputAmount) * optimalFraction));

    console.log(`[Iter ${iteration}] Predicted price: ${currentSqrtPrice.toString()}`);
    console.log(`[Iter ${iteration}] Optimal swap fraction: ${(optimalFraction * 100).toFixed(4)}%`);
    console.log(`[Iter ${iteration}] Testing swap amount: ${swapAmount} (${((Number(swapAmount) / Number(inputAmount)) * 100).toFixed(4)}%)`);

    // Evaluate this swap amount with simulation
    const result = await evaluateSwapWithSimulation(input, swapAmount);

    if (!result.isValid) {
      console.log(`[Iter ${iteration}] ❌ Invalid: ${result.error}`);
      break;
    }

    const leftoverPercent = (Number(result.totalLeftoverValue) / Number(inputAmount)) * 100;
    console.log(`[Iter ${iteration}] ✓ Leftover: ${leftoverPercent.toFixed(4)}%`);
    console.log(`[Iter ${iteration}] New predicted price: ${result.predictedSqrtPriceX96.toString()}`);

    convergenceHistory.push({
      iteration,
      swapAmount,
      predictedSqrtPrice: result.predictedSqrtPriceX96.toString(),
      leftoverPercent,
    });

    // Track best result
    if (!bestResult || result.totalLeftoverValue < bestResult.totalLeftoverValue) {
      bestResult = result;
      bestSwapAmount = swapAmount;
    }

    // Check convergence
    if (iteration > 1) {
      const prevPrice = convergenceHistory[iteration - 2].predictedSqrtPrice;
      const currPrice = result.predictedSqrtPriceX96.toString();
      const priceChangePct = Math.abs(
        (Number(currPrice) - Number(prevPrice)) / Number(prevPrice) * 100
      );

      console.log(`[Iter ${iteration}] Price change: ${priceChangePct.toFixed(6)}%`);

      if (priceChangePct < convergenceThreshold) {
        console.log(`[Iter ${iteration}] 🎯 Converged! (price change < ${convergenceThreshold}%)`);
        break;
      }
    }

    // Excellent result check
    if (leftoverPercent < 0.01) {
      console.log(`[Iter ${iteration}] 🎯 Excellent result! (leftover < 0.01%)`);
      break;
    }

    // Update predicted price for next iteration
    currentSqrtPrice = result.predictedSqrtPriceX96;
  }

  if (!bestResult || !bestResult.position) {
    throw new Error(`Optimization failed after ${maxIterations} iterations`);
  }

  // Get actual quote from V4Quoter for comparison
  const actualQuote = await getSwapQuote(inputToken, otherToken, bestSwapAmount, input.poolConfig);

  const totalLeftoverPercent = (Number(bestResult.totalLeftoverValue) / Number(inputAmount)) * 100;

  // Calculate predicted price impact
  const initialPrice = JSBI.toNumber(v4Pool.sqrtRatioX96);
  const finalPrice = JSBI.toNumber(bestResult.predictedSqrtPriceX96);
  const predictedPriceImpactPercent = Math.abs((finalPrice - initialPrice) / initialPrice * 100);

  console.log('\n=== Optimization Complete ===');
  console.log(`Best swap amount: ${bestSwapAmount} (${((Number(bestSwapAmount) / Number(inputAmount)) * 100).toFixed(4)}%)`);
  console.log(`Predicted output: ${bestResult.position.amount1.toString()}`);
  console.log(`Actual quoter output: ${actualQuote.amountOut.toString()}`);
  console.log(`Leftover: ${totalLeftoverPercent.toFixed(4)}%\n`);

  return {
    optimalSwapAmount: bestSwapAmount,
    swapOutput: actualQuote.amountOut, // Use actual quoter output for execution
    position: bestResult.position,
    leftover0: bestResult.leftover0,
    leftover1: bestResult.leftover1,
    totalLeftoverPercent,
    predictedPriceImpactPercent,
    iterations: convergenceHistory.length,
    convergenceHistory,
  };
}
