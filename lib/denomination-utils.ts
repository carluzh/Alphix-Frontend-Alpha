// Quote token priority for determining base token in price display
const QUOTE_TOKEN_PRIORITY: Record<string, number> = {
  // Mainnet
  'USDC': 10, 'ETH': 4,
  // Testnet
  'atUSDC': 10, 'atDAI': 9, 'atETH': 4,
};

export function getOptimalBaseToken(token0: string, token1: string): string {
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
  const isUsd = ['USDC', 'atUSDC', 'atDAI'].includes(denomToken);
  const isStable = poolType?.toLowerCase() === 'stable';
  return isUsd ? (isStable ? 6 : 2) : 6;
}
