/**
 * APR Calculator - Uniswap V4 Liquidity Positions
 */

import { Percent } from '@uniswap/sdk-core'
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk'
import JSBI from 'jsbi'
import { batchQuotePrices } from './quote-prices'

export interface PoolMetrics {
  totalFeesToken0: number
  avgTVLToken0: number
  days: number
}

const DAYS_PER_YEAR = 365
const BIPS_BASE = 10000

async function resolveTokenPrices(
  pool: V4Pool, token0Symbol: string, token1Symbol: string
): Promise<{ token0: number; token1: number } | null> {
  try {
    const prices = await batchQuotePrices([token0Symbol, token1Symbol])
    let p0 = prices[token0Symbol] || 0, p1 = prices[token1Symbol] || 0
    if (p0 === 0 && p1 === 0) return null
    if (p0 === 0 && p1 > 0) p0 = p1 * parseFloat(pool.token0Price.toSignificant(18))
    else if (p1 === 0 && p0 > 0) p1 = p0 * parseFloat(pool.token1Price.toSignificant(18))
    if (!isFinite(p0) || !isFinite(p1) || p0 === 0 || p1 === 0) return null
    return { token0: p0, token1: p1 }
  } catch { return null }
}

function clampAprBps(bps: number): number {
  if (!isFinite(bps) || isNaN(bps)) return 0
  return Math.min(Math.max(Math.round(bps), 0), 999900)
}

function numberToPercent(value: number): Percent {
  return new Percent(clampAprBps(value * 100), BIPS_BASE)
}

export async function calculatePositionApr(
  pool: V4Pool, tickLower: number, tickUpper: number, metrics: PoolMetrics,
  investmentUSD: number = 100, userAmounts?: { amount0: string; amount1: string; liquidity?: string }
): Promise<Percent> {
  const ZERO = new Percent(0, BIPS_BASE)
  try {
    const tick = pool.tickCurrent
    if (tick < tickLower || tick >= tickUpper) return ZERO
    if (metrics.days === 0 || metrics.avgTVLToken0 === 0) return ZERO

    const poolLiquidity = parseFloat(pool.liquidity.toString())
    if (poolLiquidity === 0 || !isFinite(poolLiquidity)) return ZERO

    const tokenPrices = await resolveTokenPrices(pool, pool.token0.symbol || '', pool.token1.symbol || '')
    if (!tokenPrices) return ZERO

    const annualFees = (metrics.totalFeesToken0 / metrics.days) * DAYS_PER_YEAR
    let positionLiquidity: number, positionValueUSD: number

    if (userAmounts?.liquidity) {
      positionLiquidity = parseFloat(userAmounts.liquidity)
      const amount0 = parseFloat(userAmounts.amount0 || '0'), amount1 = parseFloat(userAmounts.amount1 || '0')
      positionValueUSD = amount0 * tokenPrices.token0 + amount1 * tokenPrices.token1
      if (positionValueUSD <= 0) return ZERO
    } else if (userAmounts?.amount0 || userAmounts?.amount1) {
      const amount0 = parseFloat(userAmounts.amount0 || '0'), amount1 = parseFloat(userAmounts.amount1 || '0')
      if (amount0 <= 0 && amount1 <= 0) return ZERO
      positionValueUSD = amount0 * tokenPrices.token0 + amount1 * tokenPrices.token1
      const poolTVLUSD = metrics.avgTVLToken0 * tokenPrices.token0 * 2 // Assumes 50/50 split
      if (poolTVLUSD === 0) return ZERO
      positionLiquidity = poolLiquidity * (positionValueUSD / poolTVLUSD)
    } else {
      try {
        const testPos = V4Position.fromAmounts({
          pool, tickLower, tickUpper, useFullPrecision: true,
          amount0: JSBI.BigInt(1000 * 10 ** pool.token0.decimals),
          amount1: JSBI.BigInt(1000 * 10 ** pool.token1.decimals),
        })
        const usd = parseFloat(testPos.amount0.toSignificant(18)) * tokenPrices.token0 +
                    parseFloat(testPos.amount1.toSignificant(18)) * tokenPrices.token1
        positionLiquidity = parseFloat(testPos.liquidity.toString()) * (investmentUSD / usd)
        positionValueUSD = investmentUSD
      } catch {
        const avgTVLUSD = metrics.avgTVLToken0 * tokenPrices.token0
        if (avgTVLUSD === 0) return ZERO
        return numberToPercent((annualFees * tokenPrices.token0 / avgTVLUSD) * 100)
      }
    }
    if (!isFinite(positionLiquidity) || positionLiquidity <= 0) return ZERO
    // Fee share: position's share of total liquidity in range
    const apr = (annualFees * (positionLiquidity / (poolLiquidity + positionLiquidity)) * tokenPrices.token0 / positionValueUSD) * 100
    return numberToPercent(apr)
  } catch { return new Percent(0, BIPS_BASE) }
}

export function calculateRealizedApr(
  feesUSD: number,
  valueUSD: number,
  durationDays: number,
  fallbackApr?: Percent | null
): { apr: Percent | null; isFallback: boolean } {
  if (durationDays < 0.25 || valueUSD <= 0 || feesUSD <= 0) {
    return fallbackApr ? { apr: fallbackApr, isFallback: true } : { apr: null, isFallback: false }
  }
  const apr = (feesUSD / valueUSD) * (DAYS_PER_YEAR / durationDays) * 100
  if (!isFinite(apr)) {
    return fallbackApr ? { apr: fallbackApr, isFallback: true } : { apr: null, isFallback: false }
  }
  return { apr: numberToPercent(apr), isFallback: false }
}

function formatAprCore(apr: Percent | null | undefined, includePercent: boolean): string {
  if (!apr) return '-'
  const value = parseFloat(apr.toFixed(2))
  if (!isFinite(value)) return '-'
  if (value === 0) return includePercent ? '0%' : '0.00'
  const suffix = includePercent ? '%' : ''
  if (value >= 1000) return includePercent ? `${Math.round(value)}%` : Math.round(value).toLocaleString("en-US")
  if (value >= 100) return `${value.toFixed(0)}${suffix}`
  if (value >= 10) return `${value.toFixed(1)}${suffix}`
  return `${value.toFixed(2)}${suffix}`
}

export function formatApr(apr: Percent | null | undefined): string {
  return formatAprCore(apr, true)
}

export function formatAprValue(apr: Percent | null | undefined): string {
  return formatAprCore(apr, false)
}

// =============================================================================
// CONSOLIDATED APR BREAKDOWN UTILITIES
// =============================================================================

export interface APRBreakdownInput {
  /** Swap/Pool APR from trading fees */
  swapApr?: number | null;
  /** Unified Yield APR (Aave lending) - only for rehypo pools */
  unifiedYieldApr?: number | null;
  /** Points APR bonus */
  pointsApr?: number | null;
}

/**
 * Calculate total APR from breakdown components.
 * Unified Yield is only added if it exists (rehypo pools only).
 *
 * @param breakdown - APR components
 * @returns Total APR as number, or null if no valid data
 */
export function calculateTotalApr(breakdown: APRBreakdownInput): number | null {
  const swap = breakdown.swapApr ?? 0;
  const unified = breakdown.unifiedYieldApr ?? 0;
  const points = breakdown.pointsApr ?? 0;

  // If all are 0 or null, return null to indicate no data
  if (swap === 0 && unified === 0 && points === 0) {
    if (breakdown.swapApr === null && breakdown.unifiedYieldApr === null && breakdown.pointsApr === null) {
      return null;
    }
  }

  return swap + unified + points;
}

/**
 * Format total APR from breakdown for display.
 *
 * @param breakdown - APR components
 * @returns Formatted APR string (e.g., "12.50%")
 */
export function formatTotalApr(breakdown: APRBreakdownInput): string {
  const total = calculateTotalApr(breakdown);
  if (total === null) return '-';
  if (total === 0) return '0.00%';
  if (total >= 1000) return `${(total / 1000).toFixed(2)}K%`;
  if (total >= 100) return `${total.toFixed(0)}%`;
  if (total >= 10) return `${total.toFixed(1)}%`;
  return `${total.toFixed(2)}%`;
}
