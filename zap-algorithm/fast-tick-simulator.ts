/**
 * Fast tick-by-tick swap simulator using tick data (liquidityNet)
 * Optimized for frontend performance - uses pre-processed tick data
 */

import JSBI from 'jsbi';

export interface TickData {
  tickIdx: string;
  liquidityNet: string;
  liquidityGross?: string; // Optional: total liquidity referencing this tick
}

export interface SwapSimulationResult {
  finalSqrtPriceX96: JSBI;
  finalTick: number;
  amountOut: bigint;
  feeAmount: bigint;
}

/**
 * Pre-processes tick data into efficient lookup structures
 * Call this once per pool, reuse for multiple simulations
 */
export function buildTickLiquidityMap(ticks: TickData[]): {
  sortedTicks: number[];
  tickToLiquidity: Map<number, bigint>;
  tickToLiquidityNet: Map<number, bigint>; // Add net delta map
} {
  // Build tick events map with liquidityNet deltas
  const tickEvents = new Map<number, bigint>();
  
  for (const tick of ticks) {
    const tickIdx = Number(tick.tickIdx);
    if (!isFinite(tickIdx)) continue;
    
    let liquidityNet: bigint;
    try {
      liquidityNet = BigInt(tick.liquidityNet);
    } catch {
      continue;
    }
    
    // Accumulate liquidityNet at each tick (can be positive or negative)
    tickEvents.set(tickIdx, (tickEvents.get(tickIdx) || 0n) + liquidityNet);
  }
  
  // Build sorted tick array and maps
  const sortedTicks = Array.from(tickEvents.keys()).sort((a, b) => a - b);
  const tickToLiquidityNet = new Map<number, bigint>();
  
  // Calculate cumulative liquidity (for finding active liquidity at a tick)
  const tickToLiquidity = new Map<number, bigint>();
  let cumulativeLiquidity = 0n;
  
  for (const tick of sortedTicks) {
    const net = tickEvents.get(tick) || 0n;
    tickToLiquidityNet.set(tick, net);
    cumulativeLiquidity += net;
    tickToLiquidity.set(tick, cumulativeLiquidity);
  }
  
  return { sortedTicks, tickToLiquidity, tickToLiquidityNet };
}

/**
 * Fast swap simulation using pre-processed tick data
 */
export function simulateSwapFast(
  sortedTicks: number[],
  tickToLiquidity: Map<number, bigint>,
  tickToLiquidityNet: Map<number, bigint>, // Add net map parameter
  currentSqrtPriceX96: JSBI,
  currentTick: number,
  amountIn: bigint,
  zeroForOne: boolean,
  lpFeeMillionths: number
): SwapSimulationResult {
  if (amountIn === 0n) {
    return {
      finalSqrtPriceX96: currentSqrtPriceX96,
      finalTick: currentTick,
      amountOut: 0n,
      feeAmount: 0n,
    };
  }

  // Get active liquidity at current tick (binary search for efficiency)
  // Find the last tick event <= currentTick, use its cumulative liquidity
  let activeLiquidity = 0n;
  
  if (sortedTicks.length === 0) {
    activeLiquidity = 0n;
  } else {
    // Binary search for the rightmost tick <= currentTick
    let left = 0;
    let right = sortedTicks.length - 1;
    let bestIndex = -1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (sortedTicks[mid] <= currentTick) {
        bestIndex = mid;
        left = mid + 1; // Continue searching right for a better match
      } else {
        right = mid - 1;
      }
    }
    
    if (bestIndex >= 0) {
      activeLiquidity = tickToLiquidity.get(sortedTicks[bestIndex]) || 0n;
    } else {
      // Current tick is before all initialized ticks
      activeLiquidity = 0n;
    }
  }
  
  // If no liquidity available, log warning but continue (V4Quoter will validate on-chain)
  if (activeLiquidity === 0n && sortedTicks.length > 0) {
    console.log(`[simulateSwapFast] WARNING: No liquidity found at currentTick=${currentTick}, sortedTicks[0]=${sortedTicks[0]}, sortedTicks[${sortedTicks.length-1}]=${sortedTicks[sortedTicks.length-1]}. Continuing anyway - V4Quoter will validate on-chain.`);
    // Don't return early - let the swap simulation try anyway
    // If there's really no liquidity, swapInCurrentTick will return 0 output
  }
  
  console.log(`[simulateSwapFast] Starting swap: currentTick=${currentTick}, activeLiquidity=${activeLiquidity.toString()}, amountIn=${amountIn.toString()}, zeroForOne=${zeroForOne}`);

  // Start simulation
  let sqrtPriceX96 = currentSqrtPriceX96;
  let tick = currentTick;
  let amountRemaining = amountIn;
  let amountOut = 0n;
  let totalFees = 0n;

  const Q96 = JSBI.BigInt(2 ** 96);
  const MAX_ITERATIONS = 1000; // Safety limit
  let iterations = 0;

  // Simulate tick-by-tick
  while (amountRemaining > 0n && iterations < MAX_ITERATIONS) {
    iterations++;
    
    // Find next tick to cross (optimized binary search)
    let nextTick: number | null = null;
    let nextTickIndex = -1;
    
    if (zeroForOne) {
      // Selling token0, price moves down - find largest tick < current tick
      // binarySearchTick returns rightmost tick <= tick, so we need to look before that
      const searchIndex = binarySearchTick(sortedTicks, tick);
      console.log(`[simulateSwapFast] zeroForOne=true, tick=${tick}, searchIndex=${searchIndex}, sortedTicks.length=${sortedTicks.length}`);
      
      // If we found a tick <= current tick, check if there are ticks before it
      if (searchIndex >= 0) {
        console.log(`[simulateSwapFast] searchIndex=${searchIndex}, sortedTicks[searchIndex]=${sortedTicks[searchIndex]}`);
        // Start from searchIndex (which is <= tick) and look backwards
        for (let i = searchIndex; i >= 0; i--) {
          if (sortedTicks[i] < tick) {
            nextTick = sortedTicks[i];
            nextTickIndex = i;
            console.log(`[simulateSwapFast] Found nextTick=${nextTick} at index ${i}`);
            break;
          }
        }
      } else {
        console.log(`[simulateSwapFast] searchIndex=${searchIndex} (not found)`);
      }
      
      if (nextTick === null) {
        // No more ticks to cross, swap remaining in current tick
        console.log(`[simulateSwapFast] No next tick found for zeroForOne=${zeroForOne}, tick=${tick}, sortedTicks=${sortedTicks.slice(0, 5).join(',')}...`);
        const result = swapInCurrentTick(
          sqrtPriceX96,
          activeLiquidity,
          amountRemaining,
          zeroForOne,
          lpFeeMillionths,
          null
        );
        console.log(`[simulateSwapFast] swapInCurrentTick result: amountOut=${result.amountOut.toString()}, amountIn=${result.amountIn.toString()}`);
        amountOut += result.amountOut;
        totalFees += result.feeAmount;
        sqrtPriceX96 = result.sqrtPriceX96;
        // If no output, we can't continue
        if (result.amountOut === 0n && result.amountIn === 0n) {
          break;
        }
        break;
      }
      
      console.log(`[simulateSwapFast] Found nextTick=${nextTick} for zeroForOne=${zeroForOne}, currentTick=${tick}`);
    } else {
      // Buying token0, price moves up - find smallest tick > current tick
      const searchIndex = binarySearchTick(sortedTicks, tick);
      if (searchIndex >= 0 && searchIndex < sortedTicks.length - 1) {
        for (let i = searchIndex + 1; i < sortedTicks.length; i++) {
          if (sortedTicks[i] > tick) {
            nextTick = sortedTicks[i];
            nextTickIndex = i;
            break;
          }
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
        // If no output, we can't continue
        if (result.amountOut === 0n && result.amountIn === 0n) {
          break;
        }
        break;
      }
    }
    
    const nextSqrtPrice = tickToSqrtPriceX96(nextTick);
    
    console.log(`[simulateSwapFast] About to swap to next tick: currentTick=${tick}, nextTick=${nextTick}, currentSqrtPriceX96=${sqrtPriceX96.toString()}, nextSqrtPriceX96=${nextSqrtPrice.toString()}, zeroForOne=${zeroForOne}`);

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
    // In Uniswap: liquidityNet is the change when crossing from below to above
    // Going down (zeroForOne): reverse the sign (crossing from above to below)
    // Going up (!zeroForOne): use liquidityNet as-is (crossing from below to above)
    const liquidityNet = tickToLiquidityNet.get(nextTick) || 0n;
    if (zeroForOne) {
      // Going down: reverse sign
      activeLiquidity += -liquidityNet;
    } else {
      // Going up: add liquidityNet
      activeLiquidity += liquidityNet;
    }
    // Safety: prevent negative liquidity
    if (activeLiquidity < 0n) activeLiquidity = 0n;

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
 * Binary search for tick index (optimized)
 */
function binarySearchTick(sortedTicks: number[], targetTick: number): number {
  let left = 0;
  let right = sortedTicks.length - 1;
  let result = -1;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedTicks[mid] <= targetTick) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  
  return result;
}

/**
 * Swaps within a single tick range using CL math (same as original)
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
    let finalSqrtPrice: JSBI;
    let amountInUsed: bigint;

    if (targetSqrtPriceX96) {
      // For zeroForOne: amount of token0 needed to move from √P to √P' (where √P' < √P)
      // Formula: Δx = L * (√P - √P') / (√P * √P' / Q96)
      const sqrtPriceDiff = JSBI.subtract(sqrtPriceX96, targetSqrtPriceX96);
      
      // If target price is higher than current, we can't swap in this direction
      // This means the swap direction is wrong or we've already passed the target
      if (JSBI.lessThanOrEqual(sqrtPriceDiff, JSBI.BigInt(0))) {
        console.log(`[swapInCurrentTick] Target price higher than current - cannot swap zeroForOne to this target. sqrtPriceX96=${sqrtPriceX96.toString()}, targetSqrtPriceX96=${targetSqrtPriceX96.toString()}`);
        // Return zero - we've already reached or passed this tick
        return {
          amountIn: 0n,
          amountOut: 0n,
          feeAmount: 0n,
          sqrtPriceX96,
        };
      }
      
      // Formula: Δx = L * (√P - √P') / (√P * √P')
      // In Q96 terms: sqrtPriceDiff = (√P - √P') * Q96, so:
      // Δx = L * (sqrtPriceDiff / Q96) / ((sqrtPriceX96 / Q96) * (targetSqrtPriceX96 / Q96))
      //    = L * sqrtPriceDiff * Q96 / (sqrtPriceX96 * targetSqrtPriceX96)
      const priceProduct = JSBI.multiply(sqrtPriceX96, targetSqrtPriceX96);
      const amountToTargetRaw = JSBI.divide(
        JSBI.multiply(JSBI.multiply(liquidityJSBI, sqrtPriceDiff), Q96),
        priceProduct
      );
      const amountToTarget = BigInt(amountToTargetRaw.toString());
      
      // If amountToTarget is negative or zero, something is wrong
      if (amountToTarget <= 0n || amountToTarget > amountRemaining * 100n) {
        console.log(`[swapInCurrentTick] Invalid amountToTarget: ${amountToTarget.toString()}, amountRemaining=${amountRemaining.toString()}, sqrtPriceDiff=${sqrtPriceDiff.toString()}, priceProduct=${priceProduct.toString()}, liquidity=${liquidity.toString()}`);
        // If amountToTarget is unreasonably large, we can't reach the target - swap what we have
        // Don't return early, fall through to the "swap all remaining" case
        const feeAmount = (amountRemaining * BigInt(lpFeeMillionths)) / ONE_MILLION;
        amountInUsed = amountRemaining - feeAmount;
        if (amountInUsed <= 0n) {
          return {
            amountIn: 0n,
            amountOut: 0n,
            feeAmount: 0n,
            sqrtPriceX96,
          };
        }
        const amountInUsedJSBI = JSBI.BigInt(amountInUsed.toString());
        const numerator = JSBI.multiply(JSBI.multiply(liquidityJSBI, sqrtPriceX96), Q96);
        const denominatorPart1 = JSBI.multiply(liquidityJSBI, Q96);
        const denominatorPart2 = JSBI.multiply(amountInUsedJSBI, sqrtPriceX96);
        const denominator = JSBI.add(denominatorPart1, denominatorPart2);
        if (JSBI.equal(denominator, JSBI.BigInt(0))) {
          return {
            amountIn: 0n,
            amountOut: 0n,
            feeAmount: 0n,
            sqrtPriceX96,
          };
        }
        finalSqrtPrice = JSBI.divide(numerator, denominator);
        
        const sqrtPriceDiffFinal = JSBI.subtract(sqrtPriceX96, finalSqrtPrice);
        const amountOut = BigInt(
          JSBI.divide(
            JSBI.multiply(liquidityJSBI, sqrtPriceDiffFinal),
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

      const feeToTarget = (amountToTarget * BigInt(lpFeeMillionths)) / ONE_MILLION;
      const totalToTarget = amountToTarget + feeToTarget;

      if (totalToTarget >= amountRemaining) {
        const feeAmount = (amountRemaining * BigInt(lpFeeMillionths)) / ONE_MILLION;
        amountInUsed = amountRemaining - feeAmount;
        
        // Validate amountInUsed is positive
        if (amountInUsed <= 0n) {
          console.log(`[swapInCurrentTick] Invalid amountInUsed: ${amountInUsed.toString()}, amountRemaining=${amountRemaining.toString()}, feeAmount=${feeAmount.toString()}`);
          return {
            amountIn: 0n,
            amountOut: 0n,
            feeAmount: 0n,
            sqrtPriceX96,
          };
        }

        // Formula for zeroForOne: √P' = (L * √P * Q96) / (L * Q96 + Δx * √P)
        // When adding token0, price decreases (denominator increases, so result decreases)
        const amountInUsedJSBI = JSBI.BigInt(amountInUsed.toString());
        const numerator = JSBI.multiply(JSBI.multiply(liquidityJSBI, sqrtPriceX96), Q96);
        const denominatorPart1 = JSBI.multiply(liquidityJSBI, Q96);
        const denominatorPart2 = JSBI.multiply(amountInUsedJSBI, sqrtPriceX96);
        const denominator = JSBI.add(denominatorPart1, denominatorPart2);
        if (JSBI.equal(denominator, JSBI.BigInt(0))) {
          return {
            amountIn: 0n,
            amountOut: 0n,
            feeAmount: 0n,
            sqrtPriceX96,
          };
        }
        finalSqrtPrice = JSBI.divide(numerator, denominator);
      } else {
        amountInUsed = amountToTarget;
        finalSqrtPrice = targetSqrtPriceX96;
      }
    } else {
      // No target, swap all remaining
      const feeAmount = (amountRemaining * BigInt(lpFeeMillionths)) / ONE_MILLION;
      amountInUsed = amountRemaining - feeAmount;
      
      // Validate amountInUsed is positive
      if (amountInUsed <= 0n) {
        console.log(`[swapInCurrentTick] Invalid amountInUsed (no target): ${amountInUsed.toString()}, amountRemaining=${amountRemaining.toString()}, feeAmount=${feeAmount.toString()}`);
        return {
          amountIn: 0n,
          amountOut: 0n,
          feeAmount: 0n,
          sqrtPriceX96,
        };
      }

      // Formula for zeroForOne: √P' = (L * √P * Q96) / (L * Q96 + Δx * √P)
      // When adding token0, price decreases (denominator increases, so result decreases)
      const amountInUsedJSBI = JSBI.BigInt(amountInUsed.toString());
      const numerator = JSBI.multiply(JSBI.multiply(liquidityJSBI, sqrtPriceX96), Q96);
      const denominatorPart1 = JSBI.multiply(liquidityJSBI, Q96);
      const denominatorPart2 = JSBI.multiply(amountInUsedJSBI, sqrtPriceX96);
      const denominator = JSBI.add(denominatorPart1, denominatorPart2);
      if (JSBI.equal(denominator, JSBI.BigInt(0))) {
        return {
          amountIn: 0n,
          amountOut: 0n,
          feeAmount: 0n,
          sqrtPriceX96,
        };
      }
      finalSqrtPrice = JSBI.divide(numerator, denominator);
    }

    // Direction guard: zeroForOne must decrease price
    if (!JSBI.lessThan(finalSqrtPrice, sqrtPriceX96)) {
      console.log(`[swapInCurrentTick] Direction guard failed: zeroForOne=${zeroForOne}, sqrtPriceX96=${sqrtPriceX96.toString()}, finalSqrtPrice=${finalSqrtPrice.toString()}, liquidity=${liquidity.toString()}, amountInUsed=${amountInUsed.toString()}`);
      return {
        amountIn: 0n,
        amountOut: 0n,
        feeAmount: 0n,
        sqrtPriceX96,
      };
    }

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
 * Converts tick to sqrtPriceX96 (high precision)
 */
function tickToSqrtPriceX96(tick: number): JSBI {
  const Q96 = JSBI.BigInt(2 ** 96);
  
  // Use log-based calculation for precision
  // sqrtPrice = sqrt(1.0001^tick) = 1.0001^(tick/2)
  // sqrtPriceX96 = sqrtPrice * 2^96
  
  // For large ticks, use logarithms to avoid overflow
  if (Math.abs(tick) > 100000) {
    const logPrice = (tick / 2) * Math.log(1.0001);
    const sqrtPrice = Math.exp(logPrice);
    // Clamp to reasonable range to avoid overflow
    const clampedPrice = Math.max(1e-20, Math.min(1e20, sqrtPrice));
    return JSBI.BigInt(Math.floor(clampedPrice * Number(Q96)));
  }
  
  const sqrtPrice = Math.sqrt(1.0001 ** tick);
  return JSBI.BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

/**
 * Converts sqrtPriceX96 to tick (high precision)
 */
function sqrtPriceX96ToTick(sqrtPriceX96: JSBI): number {
  const Q96 = JSBI.BigInt(2 ** 96);
  
  // Convert JSBI to number safely - handle large values
  const sqrtPriceX96Num = Number(sqrtPriceX96.toString());
  const Q96Num = Number(Q96.toString());
  
  // Check for overflow/underflow
  if (!isFinite(sqrtPriceX96Num) || !isFinite(Q96Num) || Q96Num === 0) {
    // Fallback: use log-based calculation
    const sqrtPrice = Math.sqrt(Number(sqrtPriceX96.toString()) / Number(Q96.toString()));
    if (!isFinite(sqrtPrice) || sqrtPrice <= 0) {
      return 0; // Default tick if calculation fails
    }
    const price = sqrtPrice * sqrtPrice;
    if (!isFinite(price) || price <= 0) {
      return 0;
    }
    return Math.floor(Math.log(price) / Math.log(1.0001));
  }
  
  const sqrtPrice = sqrtPriceX96Num / Q96Num;
  if (!isFinite(sqrtPrice) || sqrtPrice <= 0) {
    return 0;
  }
  
  const price = sqrtPrice * sqrtPrice;
  if (!isFinite(price) || price <= 0) {
    return 0;
  }
  
  const tick = Math.log(price) / Math.log(1.0001);
  if (!isFinite(tick)) {
    return 0;
  }
  
  return Math.floor(tick);
}

