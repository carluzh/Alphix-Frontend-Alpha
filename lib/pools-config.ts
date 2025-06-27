import { getAddress, type Address } from 'viem';

// ============================================================================
// NETWORK CONFIGURATION
// ============================================================================

export const NETWORK_CONFIG = {
  CHAIN_ID: 84532, // Base Sepolia
  CHAIN_NAME: 'Base Sepolia',
  NATIVE_CURRENCY: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
} as const;

// ============================================================================
// CONTRACT ADDRESSES
// ============================================================================

export const CONTRACT_ADDRESSES = {
  // Core Uniswap V4 contracts
  STATE_VIEW: getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4"),
  POSITION_MANAGER: getAddress("0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80"),
  PERMIT2: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
  UNIVERSAL_ROUTER: getAddress("0x492e6456d9528771018deb9e87ef7750ef184104"),
  
  // Pool-specific contracts
  DEFAULT_HOOKS: getAddress("0x94ba380a340E020Dc29D7883f01628caBC975000"),
  
  // Other contracts
  FAUCET: getAddress("0x0e99563bC3412bF64B0d0913E0777e8d97ee8756"),
  
  // Special addresses
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000" as Address,
  MSG_SENDER: "0x0000000000000000000000000000000000000001" as Address,
} as const;

// ============================================================================
// TOKEN DEFINITIONS
// ============================================================================

export interface TokenDefinition {
  readonly symbol: string;
  readonly name: string;
  readonly address: Address;
  readonly decimals: number;
  readonly displayDecimals: number;
  readonly icon: string;
  readonly defaultUsdPrice: number; // Default price for fallbacks
  readonly coingeckoId?: string; // For price fetching
}

export const TOKENS: Record<string, TokenDefinition> = {
  BTCRL: {
    symbol: 'BTCRL',
    name: 'Bitcoin RL',
    address: getAddress('0x13c26fb69d48ED5a72Ce3302FC795082E2427F4D'),
    decimals: 8,
    displayDecimals: 6,
    icon: '/BTCRL.png',
    defaultUsdPrice: 77000,
    coingeckoId: 'bitcoin',
  },
  YUSDC: {
    symbol: 'YUSDC',
    name: 'Yield USD Coin',
    address: getAddress('0x663cF82e49419A3Dc88EEc65c2155b4B2D0fA335'),
    decimals: 6,
    displayDecimals: 2,
    icon: '/YUSD.png',
    defaultUsdPrice: 1,
    coingeckoId: 'usd-coin',
  },
  // Add more tokens here as needed
  // Example of how to add new tokens:
  // WETH: {
  //   symbol: 'WETH',
  //   name: 'Wrapped Ethereum',
  //   address: getAddress('0x4200000000000000000000000000000000000006'), // WETH on Base Sepolia
  //   decimals: 18,
  //   displayDecimals: 4,
  //   icon: '/weth.png',
  //   defaultUsdPrice: 2500,
  //   coingeckoId: 'ethereum',
  // },
  // USDC: {
  //   symbol: 'USDC',
  //   name: 'USD Coin',
  //   address: getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'), // USDC on Base Sepolia
  //   decimals: 6,
  //   displayDecimals: 2,
  //   icon: '/usdc.png',
  //   defaultUsdPrice: 1,
  //   coingeckoId: 'usd-coin',
  // },
} as const;

// ============================================================================
// POOL DEFINITIONS
// ============================================================================

export interface PoolConfig {
  readonly id: string; // Friendly ID for routing (e.g., "yusdc-btcrl")
  readonly name: string; // Display name
  readonly description?: string;
  readonly apiId: string; // On-chain pool ID for API calls
  readonly token0Symbol: keyof typeof TOKENS;
  readonly token1Symbol: keyof typeof TOKENS;
  readonly fee: number; // Pool fee
  readonly tickSpacing: number;
  readonly hooks: Address;
  readonly highlighted?: boolean; // Featured pool
  readonly enabled?: boolean; // Can be disabled without removing
  readonly tags?: string[]; // For categorization (e.g., "stable", "volatile")
  readonly launchDate?: string; // ISO date string
}

export const POOLS: Record<string, PoolConfig> = {
  'yusdc-btcrl': {
    id: 'yusdc-btcrl',
    name: 'YUSDC / BTCRL',
    description: 'Yield USD Coin paired with Bitcoin RL',
    apiId: '0xbcc20db9b797e211e508500469e553111c6fa8d80f7896e6db60167bcf18ce13',
    token0Symbol: 'YUSDC',
    token1Symbol: 'BTCRL',
    fee: 8388608, // V4 pool fee
    tickSpacing: 60,
    hooks: CONTRACT_ADDRESSES.DEFAULT_HOOKS,
    highlighted: true,
    enabled: true,
    tags: ['volatile', 'btc'],
    launchDate: '2024-01-01',
  },
  // Examples of how to add new pools:
  // 'weth-usdc': {
  //   id: 'weth-usdc',
  //   name: 'WETH / USDC',
  //   description: 'Wrapped Ethereum paired with USD Coin',
  //   apiId: '0x1234567890123456789012345678901234567890123456789012345678901234', // Replace with actual pool ID
  //   token0Symbol: 'WETH',
  //   token1Symbol: 'USDC',
  //   fee: 3000, // Different fee tier
  //   tickSpacing: 60,
  //   hooks: CONTRACT_ADDRESSES.DEFAULT_HOOKS,
  //   highlighted: false,
  //   enabled: true,
  //   tags: ['volatile', 'eth'],
  //   launchDate: '2024-02-01',
  // },
  // 'btcrl-usdc': {
  //   id: 'btcrl-usdc',
  //   name: 'BTCRL / USDC',
  //   description: 'Bitcoin RL paired with USD Coin',
  //   apiId: '0x5678901234567890123456789012345678901234567890123456789012345678', // Replace with actual pool ID
  //   token0Symbol: 'BTCRL',
  //   token1Symbol: 'USDC',
  //   fee: 10000, // Higher fee tier for volatile pairs
  //   tickSpacing: 200,
  //   hooks: CONTRACT_ADDRESSES.DEFAULT_HOOKS,
  //   highlighted: true, // Feature this pool
  //   enabled: true,
  //   tags: ['volatile', 'btc', 'stable'],
  //   launchDate: '2024-03-01',
  // },
} as const;

// ============================================================================
// TIMING CONSTANTS
// ============================================================================

export const TIMING = {
  PERMIT_EXPIRATION_DURATION_SECONDS: 60 * 60 * 24 * 30, // 30 days
  PERMIT_SIG_DEADLINE_DURATION_SECONDS: 60 * 30, // 30 minutes
  TX_DEADLINE_SECONDS: 60 * 30, // 30 minutes
  CACHE_DURATION_MS: 60 * 1000, // 1 minute
  PRICE_REFRESH_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get pool configuration by ID
 */
export function getPoolConfig(poolId: string): PoolConfig | null {
  return POOLS[poolId] || null;
}

/**
 * Get all enabled pools
 */
export function getEnabledPools(): PoolConfig[] {
  return Object.values(POOLS).filter(pool => pool.enabled !== false);
}

/**
 * Get highlighted/featured pools
 */
export function getFeaturedPools(): PoolConfig[] {
  return Object.values(POOLS).filter(pool => pool.highlighted === true && pool.enabled !== false);
}

/**
 * Get token definition by symbol
 */
export function getTokenConfig(symbol: string): TokenDefinition | null {
  return TOKENS[symbol] || null;
}

/**
 * Get tokens for a specific pool
 */
export function getPoolTokens(poolId: string): { token0: TokenDefinition; token1: TokenDefinition } | null {
  const pool = getPoolConfig(poolId);
  if (!pool) return null;
  
  const token0 = getTokenConfig(pool.token0Symbol);
  const token1 = getTokenConfig(pool.token1Symbol);
  
  if (!token0 || !token1) return null;
  
  return { token0, token1 };
}

/**
 * Generate pool pair display name
 */
export function getPoolDisplayName(poolId: string): string {
  const pool = getPoolConfig(poolId);
  if (!pool) return 'Unknown Pool';
  
  return pool.name;
}

/**
 * Get pool by token symbols (useful for finding pool when you have token symbols)
 */
export function getPoolByTokens(token0Symbol: string, token1Symbol: string): PoolConfig | null {
  return Object.values(POOLS).find(pool => 
    (pool.token0Symbol === token0Symbol && pool.token1Symbol === token1Symbol) ||
    (pool.token0Symbol === token1Symbol && pool.token1Symbol === token0Symbol)
  ) || null;
}

/**
 * Check if a pool exists and is enabled
 */
export function isPoolEnabled(poolId: string): boolean {
  const pool = getPoolConfig(poolId);
  return pool ? pool.enabled !== false : false;
}

/**
 * Get pools by tag
 */
export function getPoolsByTag(tag: string): PoolConfig[] {
  return Object.values(POOLS).filter(pool => 
    pool.tags?.includes(tag) && pool.enabled !== false
  );
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type TokenSymbol = keyof typeof TOKENS;
export type PoolId = keyof typeof POOLS;

// Legacy compatibility - re-export some constants with old names
export const TOKEN_DEFINITIONS = TOKENS;
export const V4_POOL_FEE = POOLS['yusdc-btcrl'].fee;
export const V4_POOL_TICK_SPACING = POOLS['yusdc-btcrl'].tickSpacing;
export const V4_POOL_HOOKS = POOLS['yusdc-btcrl'].hooks;
export const CHAIN_ID = NETWORK_CONFIG.CHAIN_ID;