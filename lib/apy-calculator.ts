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
 * @param investmentAmountUSD - Investment amount in USD (default $100)
 * @returns APR as a percentage (0-9999)
 */
export async function calculatePositionAPY(
  pool: V4Pool,
  tickLower: number,
  tickUpper: number,
  poolMetrics: PoolMetrics,
  investmentAmountUSD: number = 100
): Promise<number> {
  try {
    const currentTick = pool.tickCurrent;

    // If price is outside range, position earns no fees
    if (currentTick < tickLower || currentTick >= tickUpper) {
      return 0;
    }

    if (poolMetrics.days === 0 || poolMetrics.avgTVLToken0 === 0) {
      return 0;
    }

    // Fetch USD prices for both tokens
    const token0Symbol = pool.token0.symbol || '';
    const token1Symbol = pool.token1.symbol || '';

    // Calculate annual fees for the pool
    const feesPerDay = poolMetrics.totalFeesToken0 / poolMetrics.days;
    const annualFees = feesPerDay * 365;

    // Get pool's current liquidity (L) at current tick
    // This is the denominator - total active liquidity earning fees right now
    const poolLiquidityStr = pool.liquidity.toString();
    const poolL = parseFloat(poolLiquidityStr);

    if (poolL === 0 || isNaN(poolL) || !isFinite(poolL)) {
      return 0;
    }

    let token0PriceUSD: number;
    let token1PriceUSD: number;

    try {
      const prices = await batchGetTokenPrices([token0Symbol, token1Symbol]);
      token0PriceUSD = prices[token0Symbol] || 0;
      token1PriceUSD = prices[token1Symbol] || 0;

      // If neither token has a USD price, we can't calculate APY meaningfully
      if (token0PriceUSD === 0 && token1PriceUSD === 0) {
        return 0;
      }

      // If only one token has USD price, we can still work with it
      // by using the pool price ratio to derive the other token's value
      if (token0PriceUSD === 0 && token1PriceUSD > 0) {
        // Use token1 price and pool ratio to estimate token0 price
        const token0InToken1Terms = parseFloat(pool.token0Price.toSignificant(18));
        token0PriceUSD = token1PriceUSD * token0InToken1Terms;
      } else if (token1PriceUSD === 0 && token0PriceUSD > 0) {
        // Use token0 price and pool ratio to estimate token1 price
        const token1InToken0Terms = parseFloat(pool.token1Price.toSignificant(18));
        token1PriceUSD = token0PriceUSD * token1InToken0Terms;
      }

      // Sanity check final prices
      if (token0PriceUSD === 0 || token1PriceUSD === 0 || !isFinite(token0PriceUSD) || !isFinite(token1PriceUSD)) {
        return 0;
      }
    } catch (error) {
      console.error('[calculatePositionAPY] Failed to fetch prices:', error);
      return 0;
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

      if (isNaN(myL) || !isFinite(myL) || myL <= 0) {
        throw new Error('Invalid liquidity calculation');
      }
    } catch (error) {
      console.error('[calculatePositionAPY] Failed to calculate user liquidity:', error);
      // Fallback to base pool APR - convert to USD terms
      const avgTVLUSD = poolMetrics.avgTVLToken0 * token0PriceUSD;
      const annualFeesUSD = annualFees * token0PriceUSD;
      if (avgTVLUSD === 0) {
        return 0;
      }
      const basePoolAPR = (annualFeesUSD / avgTVLUSD) * 100;
      return Math.min(Math.max(basePoolAPR, 0), 9999);
    }

    // Calculate fee share: my L / (pool L + my L)
    const totalL = poolL + myL;
    const feeShare = myL / totalL;

    // My annual fees in token0 terms
    const myAnnualFeesToken0 = annualFees * feeShare;

    // Convert to USD for APR calculation
    const myAnnualFeesUSD = myAnnualFeesToken0 * token0PriceUSD;

    // My APR = (my annual fees in USD / my investment in USD) × 100
    const apr = (myAnnualFeesUSD / investmentAmountUSD) * 100;

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
  if (apy >= 1000) return `${Math.round(apy)}%`;
  if (apy >= 100) return `${apy.toFixed(0)}%`;
  if (apy >= 10) return `${apy.toFixed(1)}%`;
  return `${apy.toFixed(2)}%`;
}

/**
 * Calculate APY for user's position using their actual input amounts
 * Unlike calculatePositionAPY which uses a $100 test position, this uses real amounts
 */
export async function calculateUserPositionAPY(
  pool: V4Pool,
  tickLower: number,
  tickUpper: number,
  amount0: string,
  amount1: string,
  poolMetrics: PoolMetrics,
  userLiquidityFromBackend?: string
): Promise<number> {
  try {
    const amount0Num = parseFloat(amount0 || '0');
    const amount1Num = parseFloat(amount1 || '0');

    if (amount0Num <= 0 && amount1Num <= 0) return 0;

    const currentTick = pool.tickCurrent;
    if (currentTick < tickLower || currentTick >= tickUpper) return 0;
    if (poolMetrics.days === 0 || poolMetrics.avgTVLToken0 === 0) return 0;

    const token0Symbol = pool.token0.symbol || '';
    const token1Symbol = pool.token1.symbol || '';

    const feesPerDay = poolMetrics.totalFeesToken0 / poolMetrics.days;
    const annualFees = feesPerDay * 365;

    const poolL = parseFloat(pool.liquidity.toString());
    if (poolL === 0 || !isFinite(poolL)) return 0;

    let token0PriceUSD: number;
    let token1PriceUSD: number;

    try {
      const prices = await batchGetTokenPrices([token0Symbol, token1Symbol]);
      token0PriceUSD = prices[token0Symbol] || 0;
      token1PriceUSD = prices[token1Symbol] || 0;

      if (token0PriceUSD === 0 && token1PriceUSD === 0) return 0;

      if (token0PriceUSD === 0 && token1PriceUSD > 0) {
        token0PriceUSD = token1PriceUSD * parseFloat(pool.token0Price.toSignificant(18));
      } else if (token1PriceUSD === 0 && token0PriceUSD > 0) {
        token1PriceUSD = token0PriceUSD * parseFloat(pool.token1Price.toSignificant(18));
      }

      if (token0PriceUSD === 0 || token1PriceUSD === 0 || !isFinite(token0PriceUSD) || !isFinite(token1PriceUSD)) {
        return 0;
      }
    } catch {
      return 0;
    }

    let myL: number;

    if (userLiquidityFromBackend) {
      myL = parseFloat(userLiquidityFromBackend);
      if (isNaN(myL) || !isFinite(myL) || myL <= 0) return 0;
    } else {
      // Fallback: estimate based on investment proportion
      const userInvestmentUSD = (amount0Num * token0PriceUSD) + (amount1Num * token1PriceUSD);
      const poolTVLUSD = poolMetrics.avgTVLToken0 * token0PriceUSD * 2;

      if (poolTVLUSD === 0) return 0;

      const investmentShare = userInvestmentUSD / poolTVLUSD;
      myL = poolL * investmentShare;

      if (isNaN(myL) || !isFinite(myL) || myL <= 0) return 0;
    }

    const totalL = poolL + myL;
    const feeShare = myL / totalL;

    const myAnnualFeesToken0 = annualFees * feeShare;
    const myAnnualFeesUSD = myAnnualFeesToken0 * token0PriceUSD;

    const myInvestmentUSD = (amount0Num * token0PriceUSD) + (amount1Num * token1PriceUSD);
    if (myInvestmentUSD === 0) return 0;

    const apr = (myAnnualFeesUSD / myInvestmentUSD) * 100;

    return Math.min(Math.max(apr, 0), 9999);
  } catch {
    return 0;
  }
}

/**
 * Format user APY for display (no % symbol, used in AddLiquidityForm)
 */
export function formatUserAPY(apy: number): string {
  if (apy === 0) return '0.00';
  if (apy >= 1000) return `${Math.round(apy).toLocaleString()}`;
  if (apy >= 100) return `${apy.toFixed(0)}`;
  if (apy >= 10) return `${apy.toFixed(1)}`;
  return `${apy.toFixed(2)}`;
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
