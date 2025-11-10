/**
 * Tick-by-tick swap simulator
 * Uses real tick liquidity data to accurately predict post-swap price
 */

import JSBI from 'jsbi';

interface TickPosition {
  tickLower: number;
  tickUpper: number;
  liquidity: string;
}

interface SwapSimulationResult {
  finalSqrtPriceX96: JSBI;
  finalTick: number;
  amountOut: bigint;
  feeAmount: bigint;
}

/**
 * Simulates a swap tick-by-tick using real liquidity distribution
 */
export async function simulateSwap(
  positions: TickPosition[],
  currentSqrtPriceX96: JSBI,
  currentTick: number,
  amountIn: bigint,
  zeroForOne: boolean, // true = selling token0 for token1
  lpFeeMillionths: number // e.g., 10800 for 1.08%
): Promise<SwapSimulationResult> {
  if (amountIn === 0n) {
    return {
      finalSqrtPriceX96: currentSqrtPriceX96,
      finalTick: currentTick,
      amountOut: 0n,
      feeAmount: 0n,
    };
  }

  // Build tick event map: cumulative liquidity at each tick
  const tickEvents = new Map<number, bigint>();

  for (const pos of positions) {
    const pLo = Number(pos.tickLower);
    const pHi = Number(pos.tickUpper);
    if (!isFinite(pLo) || !isFinite(pHi) || pLo >= pHi) continue;

    let L: bigint;
    try {
      L = BigInt(pos.liquidity);
    } catch {
      continue;
    }
    if (L <= 0n) continue;

    // Add liquidity at lower tick, remove at upper tick
    tickEvents.set(pLo, (tickEvents.get(pLo) || 0n) + L);
    tickEvents.set(pHi, (tickEvents.get(pHi) || 0n) - L);
  }

  // Build sorted tick array and cumulative liquidity map
  const sortedTicks = Array.from(tickEvents.keys()).sort((a, b) => a - b);
  const tickToLiquidity = new Map<number, bigint>();
  let cumulativeLiquidity = 0n;

  for (const tick of sortedTicks) {
    cumulativeLiquidity += tickEvents.get(tick) || 0n;
    tickToLiquidity.set(tick, cumulativeLiquidity);
  }

  // Get active liquidity at current tick
  let activeLiquidity = 0n;
  for (let i = sortedTicks.length - 1; i >= 0; i--) {
    if (sortedTicks[i] <= currentTick) {
      activeLiquidity = tickToLiquidity.get(sortedTicks[i]) || 0n;
      break;
    }
  }

  // Start simulation
  let sqrtPriceX96 = currentSqrtPriceX96;
  let tick = currentTick;
  let amountRemaining = amountIn;
  let amountOut = 0n;
  let totalFees = 0n;

  const Q96 = JSBI.BigInt(2 ** 96);
  const ONE_MILLION = 1_000_000n;

  // Simulate tick-by-tick
  while (amountRemaining > 0n) {
    // Find next tick to cross
    let nextTick: number | null = null;
    if (zeroForOne) {
      // Selling token0, price moves down - find largest tick < current tick
      for (let i = sortedTicks.length - 1; i >= 0; i--) {
        if (sortedTicks[i] < tick) {
          nextTick = sortedTicks[i];
          break;
        }
      }
      if (nextTick === null) {
        // No more ticks to cross, swap remaining in current tick
        const result = swapInCurrentTick(
          sqrtPriceX96,
          activeLiquidity,
          amountRemaining,
          zeroForOne,
          lpFeeMillionths,
          null // no target price
        );
        amountOut += result.amountOut;
        totalFees += result.feeAmount;
        sqrtPriceX96 = result.sqrtPriceX96;
        break;
      }
    } else {
      // Buying token0, price moves up - find smallest tick > current tick
      for (let i = 0; i < sortedTicks.length; i++) {
        if (sortedTicks[i] > tick) {
          nextTick = sortedTicks[i];
          break;
        }
      }
      if (nextTick === null) {
        // No more ticks to cross
        const result = swapInCurrentTick(
          sqrtPriceX96,
          activeLiquidity,
          amountRemaining,
          zeroForOne,
          lpFeeMillionths,
          null
        );
        amountOut += result.amountOut;
        totalFees += result.feeAmount;
        sqrtPriceX96 = result.sqrtPriceX96;
        break;
      }
    }
    const nextSqrtPrice = tickToSqrtPriceX96(nextTick);

    // Swap to next tick boundary
    const result = swapInCurrentTick(
      sqrtPriceX96,
      activeLiquidity,
      amountRemaining,
      zeroForOne,
      lpFeeMillionths,
      nextSqrtPrice
    );

    amountOut += result.amountOut;
    totalFees += result.feeAmount;
    amountRemaining -= result.amountIn;
    sqrtPriceX96 = result.sqrtPriceX96;
    tick = nextTick;

    // Update active liquidity at crossed tick
    activeLiquidity = tickToLiquidity.get(nextTick) || activeLiquidity;

    // Safety: prevent infinite loops
    if (result.amountIn === 0n) break;
  }

  // Convert sqrtPrice back to tick
  const finalTick = sqrtPriceX96ToTick(sqrtPriceX96);

  return {
    finalSqrtPriceX96: sqrtPriceX96,
    finalTick,
    amountOut,
    feeAmount: totalFees,
  };
}

/**
 * Swaps within a single tick range using CL math
 */
function swapInCurrentTick(
  sqrtPriceX96: JSBI,
  liquidity: bigint,
  amountRemaining: bigint,
  zeroForOne: boolean,
  lpFeeMillionths: number,
  targetSqrtPriceX96: JSBI | null
): {
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  sqrtPriceX96: JSBI;
} {
  if (liquidity === 0n) {
    return {
      amountIn: 0n,
      amountOut: 0n,
      feeAmount: 0n,
      sqrtPriceX96,
    };
  }

  const Q96 = JSBI.BigInt(2 ** 96);
  const ONE_MILLION = 1_000_000n;
  const liquidityJSBI = JSBI.BigInt(liquidity.toString());

  if (zeroForOne) {
    // Selling token0 for token1, price decreases
    // Calculate max amount that can be swapped to reach target (if any)
    let finalSqrtPrice: JSBI;
    let amountInUsed: bigint;

    if (targetSqrtPriceX96) {
      // Calculate amount needed to reach target price
      // Δx = L * (√P - √P_target) / (√P * √P_target)
      const sqrtPriceDiff = JSBI.subtract(sqrtPriceX96, targetSqrtPriceX96);
      const priceProduct = JSBI.divide(
        JSBI.multiply(sqrtPriceX96, targetSqrtPriceX96),
        Q96
      );
      const amountToTarget = BigInt(
        JSBI.divide(
          JSBI.divide(
            JSBI.multiply(JSBI.multiply(liquidityJSBI, sqrtPriceDiff), Q96),
            priceProduct
          ),
          Q96
        ).toString()
      );

      // Add fee
      const feeToTarget = (amountToTarget * BigInt(lpFeeMillionths)) / ONE_MILLION;
      const totalToTarget = amountToTarget + feeToTarget;

      if (totalToTarget >= amountRemaining) {
        // We don't reach the target, use all remaining
        const feeAmount = (amountRemaining * BigInt(lpFeeMillionths)) / ONE_MILLION;
        amountInUsed = amountRemaining - feeAmount;

        // Calculate new price: √P' = L·√P / (L + Δx·√P)
        const numerator = JSBI.multiply(liquidityJSBI, sqrtPriceX96);
        const denominator = JSBI.add(
          JSBI.multiply(liquidityJSBI, Q96),
          JSBI.multiply(JSBI.BigInt(amountInUsed.toString()), sqrtPriceX96)
        );
        finalSqrtPrice = JSBI.divide(numerator, JSBI.divide(denominator, Q96));
      } else {
        // We hit the target
        amountInUsed = amountToTarget;
        finalSqrtPrice = targetSqrtPriceX96;
      }
    } else {
      // No target, swap all
      const feeAmount = (amountRemaining * BigInt(lpFeeMillionths)) / ONE_MILLION;
      amountInUsed = amountRemaining - feeAmount;

      const numerator = JSBI.multiply(liquidityJSBI, sqrtPriceX96);
      const denominator = JSBI.add(
        JSBI.multiply(liquidityJSBI, Q96),
        JSBI.multiply(JSBI.BigInt(amountInUsed.toString()), sqrtPriceX96)
      );
      finalSqrtPrice = JSBI.divide(numerator, JSBI.divide(denominator, Q96));
    }

    // Calculate output: Δy = L * (√P - √P')
    const sqrtPriceDiff = JSBI.subtract(sqrtPriceX96, finalSqrtPrice);
    const amountOut = BigInt(
      JSBI.divide(
        JSBI.multiply(liquidityJSBI, sqrtPriceDiff),
        Q96
      ).toString()
    );

    const actualFee = (amountInUsed * BigInt(lpFeeMillionths)) / ONE_MILLION;
    const totalAmountIn = amountInUsed + actualFee;

    return {
      amountIn: totalAmountIn,
      amountOut,
      feeAmount: actualFee,
      sqrtPriceX96: finalSqrtPrice,
    };
  } else {
    // Buying token0 with token1, price increases
    let finalSqrtPrice: JSBI;
    let amountInUsed: bigint;

    if (targetSqrtPriceX96) {
      // Δy = L * (√P_target - √P)
      const sqrtPriceDiff = JSBI.subtract(targetSqrtPriceX96, sqrtPriceX96);
      const amountToTarget = BigInt(
        JSBI.divide(
          JSBI.multiply(liquidityJSBI, sqrtPriceDiff),
          Q96
        ).toString()
      );

      const feeToTarget = (amountToTarget * BigInt(lpFeeMillionths)) / ONE_MILLION;
      const totalToTarget = amountToTarget + feeToTarget;

      if (totalToTarget >= amountRemaining) {
        const feeAmount = (amountRemaining * BigInt(lpFeeMillionths)) / ONE_MILLION;
        amountInUsed = amountRemaining - feeAmount;

        const priceDelta = JSBI.divide(
          JSBI.multiply(JSBI.BigInt(amountInUsed.toString()), Q96),
          liquidityJSBI
        );
        finalSqrtPrice = JSBI.add(sqrtPriceX96, priceDelta);
      } else {
        amountInUsed = amountToTarget;
        finalSqrtPrice = targetSqrtPriceX96;
      }
    } else {
      const feeAmount = (amountRemaining * BigInt(lpFeeMillionths)) / ONE_MILLION;
      amountInUsed = amountRemaining - feeAmount;

      const priceDelta = JSBI.divide(
        JSBI.multiply(JSBI.BigInt(amountInUsed.toString()), Q96),
        liquidityJSBI
      );
      finalSqrtPrice = JSBI.add(sqrtPriceX96, priceDelta);
    }

    // Calculate output: Δx = L * (√P' - √P) / (√P * √P')
    const sqrtPriceDiff = JSBI.subtract(finalSqrtPrice, sqrtPriceX96);
    const priceProduct = JSBI.divide(
      JSBI.multiply(sqrtPriceX96, finalSqrtPrice),
      Q96
    );
    const amountOut = BigInt(
      JSBI.divide(
        JSBI.divide(
          JSBI.multiply(JSBI.multiply(liquidityJSBI, sqrtPriceDiff), Q96),
          priceProduct
        ),
        Q96
      ).toString()
    );

    const actualFee = (amountInUsed * BigInt(lpFeeMillionths)) / ONE_MILLION;
    const totalAmountIn = amountInUsed + actualFee;

    return {
      amountIn: totalAmountIn,
      amountOut,
      feeAmount: actualFee,
      sqrtPriceX96: finalSqrtPrice,
    };
  }
}

/**
 * Converts tick to sqrtPriceX96
 */
function tickToSqrtPriceX96(tick: number): JSBI {
  const Q96 = JSBI.BigInt(2 ** 96);
  const sqrtPrice = Math.sqrt(1.0001 ** tick);
  return JSBI.BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

/**
 * Converts sqrtPriceX96 to tick (approximate)
 */
function sqrtPriceX96ToTick(sqrtPriceX96: JSBI): number {
  const Q96 = JSBI.BigInt(2 ** 96);
  const sqrtPrice = JSBI.toNumber(sqrtPriceX96) / Number(Q96);
  const price = sqrtPrice * sqrtPrice;
  return Math.floor(Math.log(price) / Math.log(1.0001));
}
