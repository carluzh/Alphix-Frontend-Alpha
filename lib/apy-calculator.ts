/**
 * APY Calculator for Uniswap V4 Liquidity Positions
 * Calculates APR based on active liquidity in user's selected range
 */

import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { batchGetTokenPrices } from './price-service';

export interface PoolMetrics {
  totalFeesToken0: number; // Total fees earned in token0 over the period
  avgTVLToken0: number; // Average TVL in token0
  days: number; // Number of days in the period
}

export interface PositionData {
  tickLower: number;
  tickUpper: number;
  liquidity: string; // Raw liquidity as string from subgraph
}

/**
 * Calculate what percentage of a position's total value is actively providing liquidity
 * at the current price using Uniswap V4 SDK Position objects.
 *
 * This creates two positions with the same liquidity L:
 * 1. The actual position with the specified range
 * 2. A full-range reference position
 *
 * Then compares their required capital. A concentrated position requires less capital
 * for the same liquidity L, which means it earns more fees per dollar invested.
 */
export function calculateActiveLiquidityPercentage(
  pool: V4Pool,
  tickLower: number,
  tickUpper: number,
): number {
  try {
    const currentTick = pool.tickCurrent;
    const tickSpacing = pool.tickSpacing;

    console.log('[calculateActiveLiquidityPercentage] Input validation:', {
      pool: `${pool.token0.symbol}/${pool.token1.symbol}`,
      tickLower,
      tickUpper,
      currentTick,
      tickSpacing,
      sqrtPriceX96: pool.sqrtRatioX96.toString(),
      fee: pool.fee,
      hooks: pool.hooks
    });

    // If price is outside range, position earns no fees
    if (currentTick < tickLower || currentTick >= tickUpper) {
      console.warn('[calculateActiveLiquidityPercentage] Price outside range:', { currentTick, tickLower, tickUpper });
      return 0;
    }

    // Validate ticks are properly aligned
    if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
      console.error('[calculateActiveLiquidityPercentage] Ticks not aligned to spacing:', {
        tickLower,
        tickUpper,
        tickSpacing,
        lowerMod: tickLower % tickSpacing,
        upperMod: tickUpper % tickSpacing
      });
      return 100; // Fallback to 100% (1x multiplier)
    }

    // Validate tick order
    if (tickLower >= tickUpper) {
      console.error('[calculateActiveLiquidityPercentage] Invalid tick order:', {
        tickLower,
        tickUpper
      });
      return 100;
    }

    // Use a fixed liquidity amount for comparison
    // The actual value doesn't matter - we're comparing ratios
    const liquidityAmount = JSBI.BigInt('1000000000000000000'); // 1e18

    console.log('[calculateActiveLiquidityPercentage] Creating concentrated position with params:', {
      tickLower,
      tickUpper,
      currentTick,
      tickSpacing,
      liquidityAmount: liquidityAmount.toString(),
      pool: `${pool.token0.symbol}/${pool.token1.symbol}`,
      token0: { symbol: pool.token0.symbol, decimals: pool.token0.decimals, address: 'address' in pool.token0 ? pool.token0.address : 'native' },
      token1: { symbol: pool.token1.symbol, decimals: pool.token1.decimals, address: 'address' in pool.token1 ? pool.token1.address : 'native' }
    });

    // Create the concentrated position
    let concentratedPosition;
    try {
      concentratedPosition = new V4Position({
        pool,
        tickLower,
        tickUpper,
        liquidity: liquidityAmount,
      });
      console.log('[calculateActiveLiquidityPercentage] Concentrated position created successfully');
    } catch (error) {
      console.error('[calculateActiveLiquidityPercentage] Failed to create concentrated position:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        tickLower,
        tickUpper,
        currentTick,
        tickSpacing,
        pool: `${pool.token0.symbol}/${pool.token1.symbol}`
      });
      throw error;
    }

    // Create a full-range position with the same liquidity
    // Align to the pool's actual tick spacing
    const MIN_TICK_RAW = -887272;
    const MAX_TICK_RAW = 887272;
    const MIN_TICK = Math.ceil(MIN_TICK_RAW / tickSpacing) * tickSpacing;
    const MAX_TICK = Math.floor(MAX_TICK_RAW / tickSpacing) * tickSpacing;

    console.log('[calculateActiveLiquidityPercentage] Creating full range position:', {
      MIN_TICK,
      MAX_TICK,
      tickSpacing
    });

    let fullRangePosition;
    try {
      fullRangePosition = new V4Position({
        pool,
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
        liquidity: liquidityAmount,
      });
      console.log('[calculateActiveLiquidityPercentage] Full range position created successfully');
    } catch (error) {
      console.error('[calculateActiveLiquidityPercentage] Failed to create full range position:', {
        error: error instanceof Error ? error.message : String(error),
        MIN_TICK,
        MAX_TICK,
        tickSpacing,
        pool: `${pool.token0.symbol}/${pool.token1.symbol}`
      });
      throw error;
    }

    // Get amounts required for each position
    const concAmount0 = parseFloat(concentratedPosition.amount0.toSignificant(18));
    const concAmount1 = parseFloat(concentratedPosition.amount1.toSignificant(18));

    const fullAmount0 = parseFloat(fullRangePosition.amount0.toSignificant(18));
    const fullAmount1 = parseFloat(fullRangePosition.amount1.toSignificant(18));

    // Get current prices
    const price0 = parseFloat(pool.token0Price.toSignificant(18));
    const price1 = parseFloat(pool.token1Price.toSignificant(18));

    // Calculate total value in token0 terms for each position
    const concTotalValue = concAmount0 + (concAmount1 / price0);
    const fullTotalValue = fullAmount0 + (fullAmount1 / price0);

    if (concTotalValue === 0) {
      return 0;
    }

    // The concentration ratio is how much less capital the concentrated position needs
    // for the same liquidity (and thus the same fee earnings)
    // Higher ratio = more concentrated = more fees per dollar
    const concentrationRatio = fullTotalValue / concTotalValue;

    // Return as percentage (0-100)
    return Math.min(Math.max(concentrationRatio * 100, 0), 10000);

  } catch (error) {
    console.error('[calculateActiveLiquidityPercentage] Error:', error);
    return 100; // Fallback to 100% (1x, like full range)
  }
}

/**
 * DEPRECATED - Not used anymore
 * We now use pool.liquidity directly which represents active liquidity at current tick
 */
export function calculateTotalActiveLiquidity(
  positions: PositionData[],
  userTickLower: number,
  userTickUpper: number,
  pool: V4Pool
): number {
  // This function is no longer used
  return 0;
}

/**
 * Calculate APR for a position using liquidity share approach
 *
 * Formula:
 * 1. Fetch USD prices for both tokens
 * 2. Calculate my liquidity (L) from $100 USD investment in this range using SDK
 * 3. Get pool's total liquidity (L) at current tick from pool.liquidity
 * 4. My fee share = my L / (pool L + my L)
 * 5. My APR = (annual fees × fee share / investment) × 100
 *
 * Key insight: Narrower ranges get MORE liquidity (L) for same capital,
 * thus higher fee share, thus higher APR.
 *
 * @param pool - V4Pool instance with current pool state
 * @param tickLower - Lower tick of the position
 * @param tickUpper - Upper tick of the position
 * @param poolMetrics - Historical metrics (fees, TVL, days)
 * @param positions - UNUSED (kept for backwards compatibility)
 * @param investmentAmountUSD - Investment amount in USD (default $100)
 * @returns APR as a percentage (0-9999)
 */
export async function calculatePositionAPY(
  pool: V4Pool,
  tickLower: number,
  tickUpper: number,
  poolMetrics: PoolMetrics,
  positions?: PositionData[],
  investmentAmountUSD: number = 100
): Promise<number> {
  try {
    const currentTick = pool.tickCurrent;

    // If price is outside range, position earns no fees
    if (currentTick < tickLower || currentTick >= tickUpper) {
      console.warn('[calculatePositionAPY] Price outside range:', { currentTick, tickLower, tickUpper });
      return 0;
    }

    if (poolMetrics.days === 0 || poolMetrics.avgTVLToken0 === 0) {
      return 0;
    }

    // Calculate annual fees for the pool
    const feesPerDay = poolMetrics.totalFeesToken0 / poolMetrics.days;
    const annualFees = feesPerDay * 365;

    // Get pool's current liquidity (L) at current tick
    // This is the denominator - total active liquidity earning fees right now
    const poolLiquidityStr = pool.liquidity.toString();
    const poolL = parseFloat(poolLiquidityStr);

    if (poolL === 0 || isNaN(poolL) || !isFinite(poolL)) {
      console.warn('[calculatePositionAPY] Invalid pool liquidity:', poolLiquidityStr);
      // Fallback to base pool APR
      const basePoolAPR = (annualFees / poolMetrics.avgTVLToken0) * 100;
      return Math.min(Math.max(basePoolAPR, 0), 9999);
    }

    // Fetch USD prices for both tokens
    const token0Symbol = pool.token0.symbol || '';
    const token1Symbol = pool.token1.symbol || '';

    let token0PriceUSD: number;
    let token1PriceUSD: number;

    try {
      const prices = await batchGetTokenPrices([token0Symbol, token1Symbol]);
      token0PriceUSD = prices[token0Symbol] || 0;
      token1PriceUSD = prices[token1Symbol] || 0;

      if (token0PriceUSD === 0 || token1PriceUSD === 0) {
        console.warn('[calculatePositionAPY] Missing USD prices, falling back to base APR');
        const basePoolAPR = (annualFees / poolMetrics.avgTVLToken0) * 100;
        return Math.min(Math.max(basePoolAPR, 0), 9999);
      }
    } catch (error) {
      console.error('[calculatePositionAPY] Failed to fetch prices:', error);
      const basePoolAPR = (annualFees / poolMetrics.avgTVLToken0) * 100;
      return Math.min(Math.max(basePoolAPR, 0), 9999);
    }

    // Calculate my liquidity (L) from $100 USD investment
    // Strategy: Use SDK's fromAmounts with large amounts, then scale based on USD value
    let myL: number;
    try {
      // Use a test amount (1000 tokens each) to see what ratio the SDK uses
      const testAmount0 = JSBI.BigInt(1000 * (10 ** pool.token0.decimals));
      const testAmount1 = JSBI.BigInt(1000 * (10 ** pool.token1.decimals));

      const testPosition = V4Position.fromAmounts({
        pool,
        tickLower,
        tickUpper,
        amount0: testAmount0,
        amount1: testAmount1,
        useFullPrecision: true
      });

      // Get the actual amounts the SDK decided to use
      const actualAmount0 = parseFloat(testPosition.amount0.toSignificant(18));
      const actualAmount1 = parseFloat(testPosition.amount1.toSignificant(18));

      // Calculate total USD value of this test position
      const totalUSDValue = (actualAmount0 * token0PriceUSD) + (actualAmount1 * token1PriceUSD);

      // Scale liquidity to match our target USD investment
      const scaleFactor = investmentAmountUSD / totalUSDValue;
      const testLiquidity = parseFloat(testPosition.liquidity.toString());
      myL = testLiquidity * scaleFactor;

      console.log('[calculatePositionAPY] Liquidity calculation:', {
        tickLower,
        tickUpper,
        currentTick,
        tickRange: tickUpper - tickLower,
        token0: token0Symbol,
        token1: token1Symbol,
        token0PriceUSD,
        token1PriceUSD,
        actualAmount0,
        actualAmount1,
        totalUSDValue: totalUSDValue.toFixed(2),
        targetUSD: investmentAmountUSD,
        scaleFactor,
        testLiquidity: testLiquidity.toExponential(2),
        finalLiquidity: myL.toExponential(2)
      });

      if (isNaN(myL) || !isFinite(myL) || myL <= 0) {
        console.warn('[calculatePositionAPY] Invalid user liquidity:', myL);
        throw new Error('Invalid liquidity calculation');
      }
    } catch (error) {
      console.error('[calculatePositionAPY] Failed to calculate user liquidity:', error);
      // Fallback to base pool APR
      const basePoolAPR = (annualFees / poolMetrics.avgTVLToken0) * 100;
      return Math.min(Math.max(basePoolAPR, 0), 9999);
    }

    // Calculate fee share: my L / (pool L + my L)
    const totalL = poolL + myL;
    const feeShare = myL / totalL;

    // My annual fees = total annual fees × my share
    const myAnnualFees = annualFees * feeShare;

    // My APR = (my annual fees / my investment) × 100
    const apr = (myAnnualFees / investmentAmountUSD) * 100;

    console.log('[calculatePositionAPY] Liquidity share calculation:', {
      tickRange: { tickLower, tickUpper, currentTick },
      investment: investmentAmountUSD,
      poolL: poolL.toExponential(2),
      myL: myL.toExponential(2),
      feeShare: (feeShare * 100).toFixed(6) + '%',
      annualFees: annualFees.toFixed(2),
      myAnnualFees: myAnnualFees.toFixed(6),
      apr: apr.toFixed(2) + '%'
    });

    return Math.min(Math.max(apr, 0), 9999);

  } catch (error) {
    console.error('[calculatePositionAPY] Error:', error);
    return 0;
  }
}

/**
 * Format APY for display
 */
export function formatAPY(apy: number): string {
  if (apy === 0) return '0%';
  if (apy >= 1000) return `~${Math.round(apy)}%`;
  if (apy >= 100) return `~${apy.toFixed(0)}%`;
  if (apy >= 10) return `~${apy.toFixed(1)}%`;
  return `~${apy.toFixed(2)}%`;
}

/**
 * Fetches pool metrics and calculates Full Range APY for a pool
 * Uses already-calculated fees from volume × fee
 */
export async function fetchPoolFullRangeAPY(poolId: string, days: number = 7): Promise<string> {
  try {
    const response = await fetch('/api/liquidity/pool-metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poolId, days })
    });

    if (!response.ok) {
      console.error('[fetchPoolFullRangeAPY] API error:', response.status);
      return "—";
    }

    const data = await response.json();

    if (!data.metrics || data.metrics.days === 0) {
      return "—";
    }

    const { totalFeesToken0, avgTVLToken0, days: actualDays } = data.metrics;

    if (avgTVLToken0 === 0 || actualDays === 0) {
      return "0.00%";
    }

    // Simple APY: annualize the fees and divide by TVL
    const feesPerDay = totalFeesToken0 / actualDays;
    const annualFees = feesPerDay * 365;
    const apy = (annualFees / avgTVLToken0) * 100;

    return formatAPY(apy);
  } catch (error) {
    console.error('[fetchPoolFullRangeAPY] Error:', error);
    return "—";
  }
}
