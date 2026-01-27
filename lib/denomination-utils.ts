import {
  TickMath,
  tickToPriceRelative,
  tickToPriceSimple,
} from '@/lib/liquidity/utils/tick-price';

// Quote token priority for determining base token in price display
const QUOTE_TOKEN_PRIORITY: Record<string, number> = {
  // Mainnet
  'USDC': 10, 'USDT': 9, 'ETH': 4,
  // Testnet
  'atUSDC': 10, 'atDAI': 9, 'atETH': 4,
};

export function getOptimalBaseToken(token0: string, token1: string, currentPrice?: number): string {
  const p0 = QUOTE_TOKEN_PRIORITY[token0] || 0;
  const p1 = QUOTE_TOKEN_PRIORITY[token1] || 0;
  // Choose token with higher priority as base
  return p1 > p0 ? token1 : token0;
}

/**
 * Get display decimals for price formatting in the Add Liquidity wizard.
 * Uses token-aware logic for appropriate precision.
 */
export function getDecimalsForDenomination(denomToken: string, poolType?: string): number {
  const isUsd = ['USDC', 'USDT', 'atUSDC', 'atDAI'].includes(denomToken);
  const isStable = poolType?.toLowerCase() === 'stable';
  return isUsd ? (isStable ? 6 : 2) : 6;
}

/**
 * Convert a tick to a price in the desired denomination.
 *
 * IMPORTANT: For display purposes, at-limit tick handling should be done at the
 * display layer using getIsTickAtLimit() from lib/liquidity/hooks/range.
 * The at-limit checks below are legacy fallbacks and do NOT account for price inversion.
 *
 * Recommended pattern (mirrors Uniswap's formatTickPrice):
 * ```typescript
 * const isTickAtLimit = getIsTickAtLimit(tickSpacing, tickLower, tickUpper);
 * if (isTickAtLimit[direction]) {
 *   return direction === Bound.LOWER ? '0' : '∞';
 * }
 * return convertTickToPrice(...);
 * ```
 *
 * @param tick - The tick to convert
 * @param currentPoolTick - Current pool tick (for relative calculation)
 * @param currentPrice - Current pool price in token1/token0 format (Uniswap standard)
 * @param baseToken - The token to use as the base for price denomination
 * @param token0Symbol - Symbol of token0
 * @param token1Symbol - Symbol of token1
 * @returns Price string in the baseToken denomination
 *
 * Note: Pool prices from Uniswap are ALWAYS in token1/token0 format.
 * - If baseToken === token1: return price as-is (token1/token0)
 * - If baseToken === token0: invert to get token0/token1
 */
export function convertTickToPrice(
  tick: number,
  currentPoolTick: number | null,
  currentPrice: string | null,
  baseToken: string,
  token0Symbol: string,
  token1Symbol: string,
): string {
  // Legacy at-limit handling - prefer using getIsTickAtLimit() at display layer
  // These checks do NOT account for price inversion and may produce incorrect results
  if (tick >= TickMath.MAX_TICK) return '∞';
  if (tick <= TickMath.MIN_TICK) return '0.00';

  // Calculate price relative to current if available
  if (currentPoolTick !== null && currentPrice) {
    const currentPriceNum = parseFloat(currentPrice);
    if (isFinite(currentPriceNum) && currentPriceNum > 0) {
      // Use consolidated utility for relative price calculation
      const priceInToken1PerToken0 = tickToPriceRelative(tick, currentPoolTick, currentPriceNum);

      // If we want token0 denomination (token0/token1), invert
      const priceAtTick = (baseToken === token0Symbol)
        ? 1 / priceInToken1PerToken0
        : priceInToken1PerToken0;

      if (isFinite(priceAtTick)) {
        if (priceAtTick < 1e-11 && priceAtTick > 0) return '0';
        if (priceAtTick > 1e30) return '∞';
        return priceAtTick.toString();
      }
    }
  }

  // Fallback: calculate from tick alone using consolidated utility
  const priceInToken1PerToken0 = tickToPriceSimple(tick);
  const priceAtTick = (baseToken === token0Symbol)
    ? 1 / priceInToken1PerToken0
    : priceInToken1PerToken0;

  if (!isFinite(priceAtTick)) return '0.00';
  if (priceAtTick < 1e-11 && priceAtTick > 0) return '0';
  if (priceAtTick > 1e30) return '∞';

  return priceAtTick.toString();
}
