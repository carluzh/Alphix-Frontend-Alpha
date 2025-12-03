// Quote token priority for determining base token in price display
// Includes both mainnet (USDC, USDT, etc.) and testnet (aUSDC, aUSDT, etc.) symbols
const QUOTE_TOKEN_PRIORITY: Record<string, number> = {
  // Mainnet symbols
  'USDC': 10, 'USDT': 9, 'DAI': 8, 'BTC': 5, 'WETH': 4, 'ETH': 2,
  // Testnet symbols (same priority as mainnet counterparts)
  'aUSDC': 10, 'aUSDT': 9, 'aDAI': 8, 'aBTC': 5, 'aETH': 4
};

export function getOptimalBaseToken(token0: string, token1: string, currentPrice?: number): string {
  const p0 = QUOTE_TOKEN_PRIORITY[token0] || 0;
  const p1 = QUOTE_TOKEN_PRIORITY[token1] || 0;
  // Choose token with higher priority as base
  return p1 > p0 ? token1 : token0;
}

export function getDecimalsForDenomination(baseToken: string, poolType?: string): number {
  const isUsd = ['aUSDT', 'aUSDC', 'USDT', 'USDC', 'aDAI', 'DAI'].includes(baseToken);
  const isStable = poolType?.toLowerCase() === 'stable';
  return isUsd ? (isStable ? 6 : 2) : 6;
}

/**
 * Convert a tick to a price in the desired denomination
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
  sdkMinTick: number = -887272,
  sdkMaxTick: number = 887272
): string {
  // Handle extreme values
  if (tick >= sdkMaxTick) return '∞';
  if (tick <= sdkMinTick) return '0.00';

  // Calculate price relative to current if available
  if (currentPoolTick !== null && currentPrice) {
    const currentPriceNum = parseFloat(currentPrice);
    if (isFinite(currentPriceNum) && currentPriceNum > 0) {
      const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
      // currentPriceNum is token1/token0 (Uniswap standard)
      const priceInToken1PerToken0 = currentPriceNum * priceDelta;

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

  // Fallback: calculate from tick alone
  const priceInToken1PerToken0 = Math.pow(1.0001, tick);
  const priceAtTick = (baseToken === token0Symbol)
    ? 1 / priceInToken1PerToken0
    : priceInToken1PerToken0;

  if (!isFinite(priceAtTick)) return '0.00';
  if (priceAtTick < 1e-11 && priceAtTick > 0) return '0';
  if (priceAtTick > 1e30) return '∞';

  return priceAtTick.toString();
}
