/**
 * Token configurations for E2E tests
 * All tokens are on Base Sepolia testnet (via Anvil fork)
 */

export interface TokenConfig {
  address: string
  symbol: string
  decimals: number
}

export const TOKENS: Record<string, TokenConfig> = {
  ETH: {
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native ETH sentinel address
    symbol: 'ETH',
    decimals: 18,
  },
  aUSDC: {
    address: '0x24429b8f2C8ebA374Dd75C0a72BCf4dF4C545BeD',
    symbol: 'aUSDC',
    decimals: 6,
  },
  aUSDT: {
    address: '0x9F785fEb65DBd0170bd6Ca1A045EEda44ae9b4dC',
    symbol: 'aUSDT',
    decimals: 6,
  },
  aETH: {
    address: '0xE7711aa6557A69592520Bbe7D704D64438f160e7',
    symbol: 'aETH',
    decimals: 18,
  },
  aBTC: {
    address: '0x9d5F910c91E69ADDDB06919825305eFEa5c9c604',
    symbol: 'aBTC',
    decimals: 8,
  },
  aDAI: {
    address: '0x6876Ef4dc1aBADd2f3dA7a0ccbF562E63b62964e',
    symbol: 'aDAI',
    decimals: 18,
  },
}

// All ERC20 tokens (excludes native ETH which doesn't need seeding)
export const ALL_TOKENS = [TOKENS.aUSDC, TOKENS.aUSDT, TOKENS.aETH, TOKENS.aBTC, TOKENS.aDAI]

/**
 * Common token pairs for swap testing
 */
export const TOKEN_PAIRS = {
  STABLECOIN_TO_STABLECOIN: [TOKENS.aUSDC, TOKENS.aUSDT],
  VOLATILE_TO_STABLECOIN: [TOKENS.aETH, TOKENS.aUSDC],
  VOLATILE_TO_VOLATILE: [TOKENS.aETH, TOKENS.aBTC],
} as const
