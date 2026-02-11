/**
 * Zap Dust Reporting Utility
 *
 * Reports leftover (dust) amounts to the user via toast notification
 * when dust exceeds the threshold (0.01% of input value).
 */

import { toast } from 'sonner';
import { createElement } from 'react';
import { IconCircleInfo } from 'nucleo-micro-bold-essential';
import { formatUnits } from 'viem';

// =============================================================================
// TYPES
// =============================================================================

export interface DustReport {
  /** Dust amount in token0 (USDS, 18 decimals) */
  token0Dust: bigint;
  /** Dust amount in token1 (USDC, 6 decimals) */
  token1Dust: bigint;
  /** Token0 symbol */
  token0Symbol: string;
  /** Token1 symbol */
  token1Symbol: string;
  /** Token0 decimals */
  token0Decimals: number;
  /** Token1 decimals */
  token1Decimals: number;
  /** Total input amount in USD (for percentage calculation) */
  inputAmountUSD: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Dust threshold - show toast if dust > 0.01% of input value */
const DUST_THRESHOLD_PERCENT = 0.01;

/** Minimum USD value to show in toast (avoid showing $0.00001) */
const MIN_DISPLAY_USD = 0.01;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Report Zap dust to user via toast notification.
 *
 * Shows an info toast if the leftover amount exceeds 0.01% of input value.
 * The toast indicates which token has leftover and the approximate USD value.
 *
 * @param dust - Dust report data
 */
export function reportZapDust(dust: DustReport): void {
  // Format dust amounts
  const dust0Formatted = Number(formatUnits(dust.token0Dust, dust.token0Decimals));
  const dust1Formatted = Number(formatUnits(dust.token1Dust, dust.token1Decimals));

  // Estimate USD values (assume stablecoins ≈ $1 each)
  const dust0USD = dust0Formatted;
  const dust1USD = dust1Formatted;
  const totalDustUSD = dust0USD + dust1USD;

  // Calculate dust as percentage of input
  const dustPercent = dust.inputAmountUSD > 0
    ? (totalDustUSD / dust.inputAmountUSD) * 100
    : 0;

  // Only show toast if dust exceeds threshold and is displayable
  if (dustPercent <= DUST_THRESHOLD_PERCENT || totalDustUSD < MIN_DISPLAY_USD) {
    return;
  }

  // Determine which token has the most dust for the message
  const primaryDustToken = dust0USD > dust1USD ? dust.token0Symbol : dust.token1Symbol;
  const primaryDustAmount = dust0USD > dust1USD ? dust0Formatted : dust1Formatted;

  // Format display values
  const displayAmount = primaryDustAmount.toFixed(4);
  const displayUSD = totalDustUSD.toFixed(2);
  const displayPercent = dustPercent.toFixed(2);

  toast('Zap completed with remainder', {
    icon: createElement(IconCircleInfo, { className: 'h-4 w-4' }),
    description: `${displayAmount} ${primaryDustToken} (~$${displayUSD}, ${displayPercent}%) remains in wallet`,
  });
}

/**
 * Calculate dust from balance delta.
 *
 * Used to compute actual dust by comparing balances before and after Zap.
 *
 * @param initialBalance0 - Token0 balance before Zap
 * @param initialBalance1 - Token1 balance before Zap
 * @param finalBalance0 - Token0 balance after Zap
 * @param finalBalance1 - Token1 balance after Zap
 * @returns Dust amounts (positive if balance increased, 0 if decreased)
 */
export function calculateDustFromDelta(
  initialBalance0: bigint,
  initialBalance1: bigint,
  finalBalance0: bigint,
  finalBalance1: bigint
): { dust0: bigint; dust1: bigint } {
  // Dust is any remaining balance increase
  // If balance decreased, dust is 0 (used for deposit)
  const dust0 = finalBalance0 > initialBalance0 ? finalBalance0 - initialBalance0 : 0n;
  const dust1 = finalBalance1 > initialBalance1 ? finalBalance1 - initialBalance1 : 0n;

  return { dust0, dust1 };
}
