/**
 * User Position APY Calculator
 * Calculates APY based on user's actual input amounts (not test positions)
 */

import { Pool as V4Pool } from '@uniswap/v4-sdk';
import { batchGetTokenPrices } from './price-service';

export interface PoolMetrics {
  totalFeesToken0: number;
  avgTVLToken0: number;
  days: number;
}

/**
 * Calculate APY for user's position using their actual input amounts
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
 * Format APY for display
 */
export function formatUserAPY(apy: number): string {
  if (apy === 0) return '0.00';
  if (apy >= 1000) return `~${Math.round(apy).toLocaleString()}`;
  if (apy >= 100) return `~${apy.toFixed(0)}`;
  if (apy >= 10) return `${apy.toFixed(1)}`;
  return `${apy.toFixed(2)}`;
}
