/**
 * APY Calculator for Uniswap V4 Liquidity Positions
 * Calculates APY based on active liquidity percentage using Uniswap V4 SDK
 */

import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';

export interface PoolMetrics {
  totalFeesToken0: number; // Total fees earned in token0 over the period
  avgTVLToken0: number; // Average TVL in token0
  days: number; // Number of days in the period
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
      token0: { symbol: pool.token0.symbol, decimals: pool.token0.decimals, address: pool.token0.address },
      token1: { symbol: pool.token1.symbol, decimals: pool.token1.decimals, address: pool.token1.address }
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
 * Calculate APY for a position
 *
 * APY = (fees earned per year / capital deployed) * 100
 *
 * For concentrated positions:
 * - They earn the same fees as a full-range position with the same liquidity L
 * - But they require less capital to achieve that liquidity L
 * - Therefore APY is higher by the concentration ratio
 */
export function calculatePositionAPY(
  pool: V4Pool,
  tickLower: number,
  tickUpper: number,
  poolMetrics: PoolMetrics
): number {
  try {
    if (poolMetrics.avgTVLToken0 === 0 || poolMetrics.days === 0) {
      return 0;
    }

    // Calculate base pool APY (full-range equivalent)
    const feesPerDay = poolMetrics.totalFeesToken0 / poolMetrics.days;
    const annualFees = feesPerDay * 365;
    const basePoolAPY = (annualFees / poolMetrics.avgTVLToken0) * 100;

    // Get concentration multiplier
    const concentrationPercentage = calculateActiveLiquidityPercentage(pool, tickLower, tickUpper);
    const concentrationMultiplier = concentrationPercentage / 100;

    // Concentrated positions earn proportionally more APY
    const positionAPY = basePoolAPY * concentrationMultiplier;

    console.log('[calculatePositionAPY]', {
      basePoolAPY,
      concentrationPercentage,
      concentrationMultiplier,
      positionAPY,
      tickRange: { tickLower, tickUpper, currentTick: pool.tickCurrent }
    });

    return Math.min(Math.max(positionAPY, 0), 9999);

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
 * This is a client-side helper for fetching APY data
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

    // Calculate base pool APY (full range)
    const feesPerDay = totalFeesToken0 / actualDays;
    const annualFees = feesPerDay * 365;
    const basePoolAPY = (annualFees / avgTVLToken0) * 100;

    return formatAPY(basePoolAPY);
  } catch (error) {
    console.error('[fetchPoolFullRangeAPY] Error:', error);
    return "—";
  }
}
