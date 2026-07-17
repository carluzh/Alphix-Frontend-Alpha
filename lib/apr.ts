/**
 * APY Calculator - Uniswap V4 Liquidity Positions
 *
 * All yields are expressed as APY (compound daily) since rehypo pools
 * auto-compound fees via lending. Lending rates from Aave are
 * already APY, so swap-fee APY + lending APY = total APY.
 */

import { Percent } from '@uniswap/sdk-core'

const DAYS_PER_YEAR = 365
const BIPS_BASE = 10000

function clampBps(bps: number): number {
  if (!isFinite(bps) || isNaN(bps)) return 0
  return Math.min(Math.max(Math.round(bps), 0), 999900)
}

function numberToPercent(value: number): Percent {
  return new Percent(clampBps(value * 100), BIPS_BASE)
}

export function calculateRealizedApy(
  feesUSD: number,
  valueUSD: number,
  durationDays: number,
  fallbackApy?: Percent | null
): { apy: Percent | null; isFallback: boolean } {
  if (durationDays < 0.25 || valueUSD <= 0 || feesUSD <= 0) {
    return fallbackApy ? { apy: fallbackApy, isFallback: true } : { apy: null, isFallback: false }
  }
  // Daily rate from realized fees, then compound
  const dailyRate = (feesUSD / valueUSD) / durationDays
  const apy = ((1 + dailyRate) ** DAYS_PER_YEAR - 1) * 100
  if (!isFinite(apy)) {
    return fallbackApy ? { apy: fallbackApy, isFallback: true } : { apy: null, isFallback: false }
  }
  return { apy: numberToPercent(apy), isFallback: false }
}

function formatApyCore(apy: Percent | null | undefined, includePercent: boolean): string {
  if (!apy) return '-'
  const value = parseFloat(apy.toFixed(2))
  if (!isFinite(value)) return '-'
  if (value === 0) return includePercent ? '0%' : '0.00'
  const suffix = includePercent ? '%' : ''
  if (value >= 1000) return includePercent ? `${Math.round(value)}%` : Math.round(value).toLocaleString("en-US")
  if (value >= 100) return `${value.toFixed(0)}${suffix}`
  if (value >= 10) return `${value.toFixed(1)}${suffix}`
  return `${value.toFixed(2)}${suffix}`
}

export function formatApy(apy: Percent | null | undefined): string {
  return formatApyCore(apy, true)
}

// =============================================================================
// CONSOLIDATED APY BREAKDOWN UTILITIES
// =============================================================================

export interface APYBreakdownInput {
  /** Swap/Pool APY from trading fees (daily compounded) */
  swapApy?: number | null;
  /** Unified Yield APY (Aave lending) - only for rehypo pools */
  unifiedYieldApy?: number | null;
  /** Points APY bonus */
  pointsApy?: number | null;
}

/**
 * Calculate total APY from breakdown components.
 * Unified Yield is only added if it exists (rehypo pools only).
 *
 * @param breakdown - APY components
 * @returns Total APY as number, or null if no valid data
 */
export function calculateTotalApy(breakdown: APYBreakdownInput): number | null {
  const swap = breakdown.swapApy ?? 0;
  const unified = breakdown.unifiedYieldApy ?? 0;
  const points = breakdown.pointsApy ?? 0;

  // If all are 0 or null, return null to indicate no data
  if (swap === 0 && unified === 0 && points === 0) {
    if (breakdown.swapApy === null && breakdown.unifiedYieldApy === null && breakdown.pointsApy === null) {
      return null;
    }
  }

  return swap + unified + points;
}

/**
 * Format total APY from breakdown for display.
 *
 * @param breakdown - APY components
 * @returns Formatted APY string (e.g., "12.50%")
 */
export function formatTotalApy(breakdown: APYBreakdownInput): string {
  const total = calculateTotalApy(breakdown);
  if (total === null) return '-';
  if (total === 0) return '0.00%';
  if (total >= 1000) return `${(total / 1000).toFixed(2)}K%`;
  if (total >= 100) return `${total.toFixed(0)}%`;
  if (total >= 10) return `${total.toFixed(1)}%`;
  return `${total.toFixed(2)}%`;
}

// =============================================================================
// BACKWARDS COMPAT — old names re-exported for gradual migration
// =============================================================================
/** @deprecated Use calculateRealizedApy */
export const calculateRealizedApr = calculateRealizedApy;
/** @deprecated Use formatApy */
export const formatApr = formatApy;
