/**
 * Zap Dust Reporting Utility
 *
 * Reports leftover (dust) amounts to the user via toast notification
 * when dust exceeds the threshold (0.01% of input value).
 */

import { toast } from 'sonner';
import { formatUnits } from 'viem';

// =============================================================================
// TYPES
// =============================================================================

export interface DustReport {
  token0Dust: bigint;
  token1Dust: bigint;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  inputAmountUSD: number;
  inputToken?: string;
  /** Token0 price in USD (for non-stablecoin dust calculation, defaults to 1) */
  token0Price?: number;
  /** Token1 price in USD (for non-stablecoin dust calculation, defaults to 1) */
  token1Price?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DUST_THRESHOLD_PERCENT = 0.01;
const MIN_DISPLAY_USD = 0.01;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

export function reportZapDust(dust: DustReport): void {
  const dust0Formatted = Number(formatUnits(dust.token0Dust, dust.token0Decimals));
  const dust1Formatted = Number(formatUnits(dust.token1Dust, dust.token1Decimals));
  // Use token prices for USD conversion (default to 1 for stablecoins)
  const dust0USD = dust0Formatted * (dust.token0Price ?? 1);
  const dust1USD = dust1Formatted * (dust.token1Price ?? 1);
  const totalDustUSD = dust0USD + dust1USD;

  const dustPercent = dust.inputAmountUSD > 0
    ? (totalDustUSD / dust.inputAmountUSD) * 100
    : 0;

  if (dustPercent <= DUST_THRESHOLD_PERCENT || totalDustUSD < MIN_DISPLAY_USD) {
    return;
  }

  // Build description showing each token's remainder separately
  const parts: string[] = [];
  if (dust0Formatted >= 0.0001) {
    parts.push(`${dust0Formatted.toFixed(4)} ${dust.token0Symbol}`);
  }
  if (dust1Formatted >= 0.0001) {
    parts.push(`${dust1Formatted.toFixed(4)} ${dust.token1Symbol}`);
  }
  const tokenList = parts.length > 0 ? parts.join(' + ') : '< 0.0001';

  toast.info('Zap completed with remainder', {
    description: `${tokenList} (~$${totalDustUSD.toFixed(2)}, ${dustPercent.toFixed(2)}%) remains in wallet`,
  });
}
