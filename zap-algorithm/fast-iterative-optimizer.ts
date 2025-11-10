/**
 * Fast Iterative Zap Optimizer
 * Uses tick liquidity data for accurate price prediction
 * Optimized for frontend performance (<3 seconds)
 */

import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { buildTickLiquidityMap, simulateSwapFast, TickData } from './fast-tick-simulator';

interface OptimizationInput {
  v4Pool: V4Pool;
  inputToken: Token;
  otherToken: Token;
  inputAmount: bigint;
  tickLower: number;
  tickUpper: number;
  poolConfig: any;
  tickData: TickData[]; // Pre-fetched tick data
  lpFeeMillionths: number;
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

  const unitLiquidity = 1;
  const amount0ForUnit = (unitLiquidity * (sqrtPriceUpper - sqrtPriceCurrent)) / (sqrtPriceCurrent * sqrtPriceUpper);
  const amount1ForUnit = unitLiquidity * (sqrtPriceCurrent - sqrtPriceLower);

  const currentPrice = sqrtPriceCurrent * sqrtPriceCurrent;
  const value0Needed = amount0ForUnit * currentPrice;
  const value1Needed = amount1ForUnit;
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
 * Evaluates a swap amount using fast tick simulation
 */
function evaluateSwapWithSimulation(
  input: OptimizationInput,
  swapAmount: bigint,
  sortedTicks: number[],
  tickToLiquidity: Map<number, bigint>,
  tickToLiquidityNet: Map<number, bigint>
): {
  isValid: boolean;
  position: V4Position | null;
  leftover0: bigint;
  leftover1: bigint;
  totalLeftoverValue: bigint;
  predictedSqrtPriceX96: JSBI;
  swapOutput: bigint;
  error?: string;
} {
  const { v4Pool, inputToken, otherToken, inputAmount, tickLower, tickUpper, poolConfig, lpFeeMillionths } = input;
  const inputIsToken0 = inputToken.sortsBefore(otherToken);

  let swapOutput: bigint = 0n;
  let amount0: bigint = 0n;
  let amount1: bigint = 0n;
  let simulationResult: any;

  try {
    // Step 1: Simulate swap to predict post-swap price
    const zeroForOne = inputIsToken0;
    
    // Capture simulation inputs for diagnostics
    const currentTickLiquidity = tickToLiquidity.get(v4Pool.tickCurrent) || 0n;
    const nearbyTicks = sortedTicks
      .filter(t => Math.abs(t - v4Pool.tickCurrent) < 1000)
      .slice(0, 10)
      .map(t => ({
        tick: t,
        liquidity: tickToLiquidity.get(t)?.toString() || '0',
        liquidityNet: tickToLiquidityNet.get(t)?.toString() || '0',
      }));
    
    simulationResult = simulateSwapFast(
      sortedTicks,
      tickToLiquidity,
      tickToLiquidityNet,
      v4Pool.sqrtRatioX96,
      v4Pool.tickCurrent,
      swapAmount,
      zeroForOne,
      lpFeeMillionths
    );

    const predictedSqrtPriceX96 = simulationResult.finalSqrtPriceX96;
    swapOutput = simulationResult.amountOut;

    // Validate swap output is positive
    if (swapOutput < 0n) {
      throw new Error(`Invalid swap output: ${swapOutput}, swapAmount: ${swapAmount}`);
    }
    
    // If swap produces zero output, it means no liquidity or invalid swap
    if (swapOutput === 0n && swapAmount > 0n) {
      // Deep dive: Check what happened in simulation
      const ticksInDirection = zeroForOne
        ? sortedTicks.filter(t => t < v4Pool.tickCurrent) // token0→token1: need ticks BELOW
        : sortedTicks.filter(t => t > v4Pool.tickCurrent); // token1→token0: need ticks ABOVE
      
      const liquidityAtCurrent = tickToLiquidity.get(v4Pool.tickCurrent) || 0n;
      const liquidityNetAtCurrent = tickToLiquidityNet.get(v4Pool.tickCurrent) || 0n;
      const isCurrentTickInRange = sortedTicks.length > 0 
        ? v4Pool.tickCurrent >= sortedTicks[0] && v4Pool.tickCurrent <= sortedTicks[sortedTicks.length - 1]
        : false;
      
      throw new Error(
        `Swap produced zero output: swapAmount=${swapAmount}\n` +
        `\n` +
        `ROOT CAUSE ANALYSIS:\n` +
        `===================\n` +
        `1. Swap Direction: ${zeroForOne ? 'token0→token1 (price moves DOWN)' : 'token1→token0 (price moves UP)'}\n` +
        `2. Current Tick: ${v4Pool.tickCurrent}\n` +
        `3. Liquidity at Current Tick: ${liquidityAtCurrent.toString()}\n` +
        `4. LiquidityNet at Current Tick: ${liquidityNetAtCurrent.toString()}\n` +
        `5. Current Tick in Range: ${isCurrentTickInRange}\n` +
        `6. Ticks in Swap Direction: ${ticksInDirection.length} ticks\n` +
        `   ${ticksInDirection.length > 0 ? `Range: [${ticksInDirection[0]}, ${ticksInDirection[ticksInDirection.length - 1]}]` : 'NONE - This is the problem!'}\n` +
        `7. All Sorted Ticks Range: ${sortedTicks.length > 0 ? `[${sortedTicks[0]}, ${sortedTicks[sortedTicks.length - 1]}]` : 'empty'}\n` +
        `8. Position Tick Range: [${tickLower}, ${tickUpper}]\n` +
        `\n` +
        `DIAGNOSIS:\n` +
        `${liquidityAtCurrent === 0n ? '❌ NO LIQUIDITY at current tick\n' : '✓ Has liquidity at current tick\n'}` +
        `${ticksInDirection.length === 0 ? '❌ NO TICKS in swap direction - price cannot move!\n' : `✓ Has ${ticksInDirection.length} ticks in swap direction\n`}` +
        `${!isCurrentTickInRange ? '❌ Current tick is OUTSIDE liquidity range\n' : '✓ Current tick is within liquidity range\n'}` +
        `\n` +
        `LIKELY ISSUE: ${ticksInDirection.length === 0 
          ? 'Cannot swap in this direction - no liquidity positions allow price to move this way. The current price tick might be at the edge of all liquidity positions.'
          : liquidityAtCurrent === 0n
          ? 'No liquidity at current price tick. The pool may be empty or positions don\'t cover this tick.'
          : 'swapInCurrentTick returned zero - check liquidity or direction guard'
        }\n` +
        `\n` +
        `Full Diagnostics:\n` +
        `${JSON.stringify({
          swapAmount: swapAmount.toString(),
          zeroForOne,
          swapDirection: zeroForOne ? `${inputToken.symbol} → ${otherToken.symbol} (token0→token1)` : `${inputToken.symbol} → ${otherToken.symbol} (token1→token0)`,
          currentTick: v4Pool.tickCurrent,
          currentSqrtPriceX96: v4Pool.sqrtRatioX96.toString(),
          currentTickLiquidity: liquidityAtCurrent.toString(),
          sortedTicksCount: sortedTicks.length,
          sortedTicksRange: sortedTicks.length > 0 ? `[${sortedTicks[0]}, ${sortedTicks[sortedTicks.length - 1]}]` : 'empty',
          tickRange: `[${tickLower}, ${tickUpper}]`,
          inputIsToken0,
          inputToken: inputToken.symbol,
          otherToken: otherToken.symbol,
          nearbyTicks,
          ticksInDirection: ticksInDirection.slice(0, 5).map(t => ({
            tick: t,
            liquidity: tickToLiquidity.get(t)?.toString() || '0',
          })),
          liquidityAtCurrent: liquidityAtCurrent.toString(),
          liquidityNetAtCurrent: liquidityNetAtCurrent.toString(),
          isCurrentTickInRange,
          simulationResult: {
            finalTick: simulationResult.finalTick,
            amountOut: simulationResult.amountOut.toString(),
            feeAmount: simulationResult.feeAmount.toString(),
          },
        }, null, 2)}`
      );
    }

    // Step 2: Create V4Pool at predicted price for V4Position.fromAmounts()
    // Validate amounts before creating position
    const remainingInput = inputAmount - swapAmount;
    amount0 = inputIsToken0 ? remainingInput : swapOutput;
    amount1 = inputIsToken0 ? swapOutput : remainingInput;

    // Validate amounts are positive
    if (amount0 <= 0n && amount1 <= 0n) {
      throw new Error(`Invalid amounts: amount0=${amount0}, amount1=${amount1}, swapAmount=${swapAmount}, swapOutput=${swapOutput}`);
    }

    // Validate predicted price is within tick range
    const predictedTick = simulationResult.finalTick;
    const isOutOfRange = predictedTick < tickLower || predictedTick > tickUpper;

    const predictedPool = new V4Pool(
      inputIsToken0 ? inputToken : otherToken,
      inputIsToken0 ? otherToken : inputToken,
      poolConfig.fee,
      poolConfig.tickSpacing,
      poolConfig.hooks,
      predictedSqrtPriceX96,
      v4Pool.liquidity, // Keep same total liquidity (approximation)
      simulationResult.finalTick
    );

    // Step 3: Calculate position at predicted price
    // If price is out of range, use fromAmount0 or fromAmount1 instead of fromAmounts
    let position: V4Position;
    if (isOutOfRange) {
      // Price is outside range - determine which token is needed
      const needsToken0Only = predictedTick >= tickUpper;
      const needsToken1Only = predictedTick <= tickLower;
      
      if (needsToken0Only) {
        // Only token0 needed - use amount0 only, ignore amount1
        if (amount0 <= 0n) {
          throw new Error(`Out of range position needs token0 but amount0 is ${amount0}`);
        }
        position = V4Position.fromAmount0({
          pool: predictedPool,
          tickLower,
          tickUpper,
          amount0: JSBI.BigInt(amount0.toString()),
          useFullPrecision: true,
        });
      } else if (needsToken1Only) {
        // Only token1 needed - use amount1 only, ignore amount0
        if (amount1 <= 0n) {
          throw new Error(`Out of range position needs token1 but amount1 is ${amount1}`);
        }
        position = V4Position.fromAmount1({
          pool: predictedPool,
          tickLower,
          tickUpper,
          amount1: JSBI.BigInt(amount1.toString()),
        });
      } else {
        // Shouldn't happen if isOutOfRange is true, but fallback to fromAmounts
        if (amount0 <= 0n || amount1 <= 0n) {
          throw new Error(`Invalid amounts for in-range position: amount0=${amount0}, amount1=${amount1}`);
        }
        position = V4Position.fromAmounts({
          pool: predictedPool,
          tickLower,
          tickUpper,
          amount0: JSBI.BigInt(amount0.toString()),
          amount1: JSBI.BigInt(amount1.toString()),
          useFullPrecision: true,
        });
      }
    } else {
      // Price is in range - use fromAmounts, but validate both amounts are positive
      if (amount0 <= 0n || amount1 <= 0n) {
        throw new Error(`Invalid amounts for in-range position: amount0=${amount0}, amount1=${amount1}`);
      }
      position = V4Position.fromAmounts({
        pool: predictedPool,
        tickLower,
        tickUpper,
        amount0: JSBI.BigInt(amount0.toString()),
        amount1: JSBI.BigInt(amount1.toString()),
        useFullPrecision: true,
      });
    }

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
      swapOutput,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Log more details about what went wrong
    if (errorMessage.includes('Invariant failed')) {
      console.warn('[Zap Optimizer] Position creation failed:', {
        swapAmount: swapAmount.toString(),
        inputAmount: inputAmount.toString(),
        remainingInput: swapOutput !== undefined ? (inputAmount - swapAmount).toString() : 'N/A',
        swapOutput: swapOutput?.toString() || 'N/A',
        amount0: amount0?.toString() || 'N/A',
        amount1: amount1?.toString() || 'N/A',
        predictedTick: simulationResult?.finalTick || 'N/A',
        tickRange: `[${tickLower}, ${tickUpper}]`,
        isOutOfRange: simulationResult?.finalTick !== undefined ? (simulationResult.finalTick < tickLower || simulationResult.finalTick > tickUpper) : 'N/A',
        inputIsToken0,
      });
    }
    return {
      isValid: false,
      position: null,
      leftover0: 0n,
      leftover1: 0n,
      totalLeftoverValue: inputAmount,
      predictedSqrtPriceX96: v4Pool.sqrtRatioX96,
      swapOutput: 0n,
      error: errorMessage,
    };
  }
}

/**
 * Fast iterative optimizer with performance optimizations
 * Max 5 iterations, early exit conditions, optimized for <3s runtime
 */
export async function optimizeZapFast(
  input: OptimizationInput,
  maxIterations: number = 5, // Reduced from 10 for speed
  convergenceThreshold: number = 0.05 // 0.05% - relaxed for faster convergence
): Promise<OptimizationResult> {
  const startTime = performance.now();
  const { inputAmount, v4Pool, inputToken, otherToken, tickLower, tickUpper, tickData } = input;
  const inputIsToken0 = inputToken.sortsBefore(otherToken);

  // Pre-process tick data once (reused for all iterations)
  const { sortedTicks, tickToLiquidity, tickToLiquidityNet } = buildTickLiquidityMap(tickData);

  let currentSqrtPrice = v4Pool.sqrtRatioX96;
  let bestResult: Awaited<ReturnType<typeof evaluateSwapWithSimulation>> | null = null;
  let bestSwapAmount = 0n;
  let iterations = 0;

  // Iterative convergence
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;
    
    // Calculate optimal swap amount at current predicted price
    const optimalFraction = calculateOptimalFractionAtPrice(
      currentSqrtPrice,
      tickLower,
      tickUpper,
      inputIsToken0
    );
    const swapAmount = BigInt(Math.floor(Number(inputAmount) * optimalFraction));

    // Evaluate this swap amount with simulation
    const result = evaluateSwapWithSimulation(
      input,
      swapAmount,
      sortedTicks,
      tickToLiquidity,
      tickToLiquidityNet
    );

    if (!result.isValid) {
      // Log why it's invalid for debugging
      if (iteration === 1) {
        console.warn('[Zap Optimizer] First iteration failed:', {
          swapAmount: swapAmount.toString(),
          error: result.error,
          inputAmount: inputAmount.toString(),
          tickRange: `[${tickLower}, ${tickUpper}]`,
        });
      }
      // If invalid, try a smaller swap amount
      if (bestResult) break; // Use best result so far
      continue;
    }

    const leftoverPercent = (Number(result.totalLeftoverValue) / Number(inputAmount)) * 100;

    // Track best result
    if (!bestResult || result.totalLeftoverValue < bestResult.totalLeftoverValue) {
      bestResult = result;
      bestSwapAmount = swapAmount;
    }

    // Early exit conditions for speed
    if (leftoverPercent < 0.01) {
      // Excellent result - stop early
      break;
    }

    // Check convergence (compare with previous iteration)
    if (iteration > 1 && bestResult) {
      const prevPrice = currentSqrtPrice.toString();
      const currPrice = result.predictedSqrtPriceX96.toString();
      const priceChangePct = Math.abs(
        (Number(currPrice) - Number(prevPrice)) / Number(prevPrice) * 100
      );

      if (priceChangePct < convergenceThreshold) {
        // Converged - stop early
        break;
      }
    }

    // Update predicted price for next iteration
    currentSqrtPrice = result.predictedSqrtPriceX96;
  }

  if (!bestResult || !bestResult.position) {
    // Fallback: try a couple of heuristic swap amounts to avoid hard fail
    const { sortedTicks, tickToLiquidity, tickToLiquidityNet } = buildTickLiquidityMap(tickData);
    const fallbackFractions = [0.5, 0.33, 0.67];
    for (const frac of fallbackFractions) {
      const sa = BigInt(Math.floor(Number(inputAmount) * frac));
      const r = evaluateSwapWithSimulation(
        input,
        sa,
        sortedTicks,
        tickToLiquidity,
        tickToLiquidityNet
      );
      if (r.isValid && r.position) {
        bestResult = r;
        iterations += 1;
        break;
      }
    }
  }
  if (!bestResult || !bestResult.position) {
    const duration = performance.now() - startTime;
    console.error('[Zap Optimizer] Optimization failed:', {
      input: {
        token: `${inputToken.symbol} → ${otherToken.symbol}`,
        amount: inputAmount.toString(),
        range: `[${tickLower}, ${tickUpper}]`,
      },
      performance: {
        iterations,
        duration: `${duration.toFixed(0)}ms`,
        ticksProcessed: tickData.length,
      },
      error: 'All iterations returned invalid results',
    });
    throw new Error(`Optimization failed after ${iterations} iterations`);
  }

  const totalLeftoverPercent = (Number(bestResult.totalLeftoverValue) / Number(inputAmount)) * 100;

  // Calculate predicted price impact
  const initialPrice = JSBI.toNumber(v4Pool.sqrtRatioX96);
  const finalPrice = JSBI.toNumber(bestResult.predictedSqrtPriceX96);
  const predictedPriceImpactPercent = Math.abs((finalPrice - initialPrice) / initialPrice * 100);

  const duration = performance.now() - startTime;

  // Single console log with all relevant debugging data
  console.log('[Zap Optimizer]', {
    input: {
      token: `${inputToken.symbol} → ${otherToken.symbol}`,
      amount: inputAmount.toString(),
      range: `[${tickLower}, ${tickUpper}]`,
    },
    result: {
      swapAmount: bestSwapAmount.toString(),
      swapPercent: `${((Number(bestSwapAmount) / Number(inputAmount)) * 100).toFixed(2)}%`,
      leftover: `${totalLeftoverPercent.toFixed(4)}%`,
      priceImpact: `${predictedPriceImpactPercent.toFixed(4)}%`,
    },
    performance: {
      iterations,
      duration: `${duration.toFixed(0)}ms`,
      ticksProcessed: tickData.length,
    },
  });

  return {
    optimalSwapAmount: bestSwapAmount,
    swapOutput: bestResult.swapOutput,
    position: bestResult.position,
    leftover0: bestResult.leftover0,
    leftover1: bestResult.leftover1,
    totalLeftoverPercent,
    predictedPriceImpactPercent,
    iterations,
  };
}

