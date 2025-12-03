import { getAddress, type Address } from 'viem';
import { Token } from '@uniswap/sdk-core';
import testnetPoolsConfig from '../config/testnet_pools.json';
import mainnetPoolsConfig from '../config/pools.json';
import { getStoredNetworkMode, getNetworkModeFromCookies, type NetworkMode } from './network-mode';

// Re-export NetworkMode for use by other modules
export type { NetworkMode };

// Type definitions for pools config structure
interface PoolsConfigFile {
  meta: { version: string; description: string; chainId: number; chainName: string };
  contracts: { poolManager: string; universalRouter?: string; quoter: string; positionManager: string; stateView: string };
  hooks: { alphixHookId: string };
  tokens: Record<string, { symbol: string; name: string; address: string; decimals: number; icon: string; usdPrice?: string }>;
  pools: Array<{
    id: string;
    name: string;
    description: string;
    subgraphId: string;
    currency0: { symbol: string; address: string };
    currency1: { symbol: string; address: string };
    fee: number;
    tickSpacing: number;
    hooks: string;
    enabled: boolean;
    featured: boolean;
    type?: string;
  }>;
  fees: { initialFee: number; initialTargetRatio: string; currentRatio: string };
}

/**
 * Get the pools config for a specific network mode.
 * This is called dynamically rather than at module load time to support
 * runtime network switching via cookies/localStorage.
 *
 * @param networkModeOverride - Optional override for network mode (useful for API routes with cookies)
 */
function getPoolsConfig(networkModeOverride?: NetworkMode): PoolsConfigFile {
  const networkMode = networkModeOverride ?? getStoredNetworkMode();
  return networkMode === 'mainnet'
    ? (mainnetPoolsConfig as PoolsConfigFile)
    : (testnetPoolsConfig as PoolsConfigFile);
}

/**
 * Get network mode from request cookies (for API routes).
 * Pass the cookie header value from the request.
 */
export function getNetworkModeFromRequest(cookieHeader: string | undefined | null): NetworkMode {
  return getNetworkModeFromCookies(cookieHeader) ?? getStoredNetworkMode();
}

// Types based on pools.json structure
export interface TokenConfig {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
}

export interface PoolCurrency {
  symbol: string;
  address: string;
}

export interface PoolConfig {
  id: string;
  name: string;
  description: string;
  subgraphId: string;
  currency0: PoolCurrency;
  currency1: PoolCurrency;
  fee: number;
  tickSpacing: number;
  hooks: string;
  enabled: boolean;
  featured: boolean;
  type?: string; // Add the new type property
}

export interface ContractsConfig {
  poolManager: string;
  universalRouter?: string;
  quoter: string;
  positionManager: string;
  stateView: string;
}

// Utility functions - all use dynamic config selection
export function getAllTokens(networkModeOverride?: NetworkMode): Record<string, TokenConfig> {
  return getPoolsConfig(networkModeOverride).tokens;
}

export function getToken(symbol: string, networkModeOverride?: NetworkMode): TokenConfig | null {
  const config = getPoolsConfig(networkModeOverride);
  return config.tokens[symbol as keyof typeof config.tokens] || null;
}

export function getTokenDecimals(symbol: string, networkModeOverride?: NetworkMode): number | null {
  const token = getToken(symbol, networkModeOverride);
  return token?.decimals || null;
}

export function getAllPools(networkModeOverride?: NetworkMode): PoolConfig[] {
  return getPoolsConfig(networkModeOverride).pools;
}

export function getEnabledPools(networkModeOverride?: NetworkMode): PoolConfig[] {
  return getPoolsConfig(networkModeOverride).pools.filter(pool => pool.enabled);
}

export function getFeaturedPools(networkModeOverride?: NetworkMode): PoolConfig[] {
  return getPoolsConfig(networkModeOverride).pools.filter(pool => pool.featured && pool.enabled);
}

export function getPoolByTokens(tokenA: string, tokenB: string, networkModeOverride?: NetworkMode): PoolConfig | null {
  const config = getPoolsConfig(networkModeOverride);
  // Find all pools that match the unordered pair of symbols
  const matches = config.pools.filter(pool => {
    const a = pool.currency0.symbol;
    const b = pool.currency1.symbol;
    return (a === tokenA && b === tokenB) || (a === tokenB && b === tokenA);
  });

  if (matches.length === 0) return null;

  // Prefer canonical aliases if multiple pools match
  const priority: Record<string, number> = {
    // USDC family
    'aUSDC': 100,
    'USDC': 80,
    'yUSDC': 60,
    'YUSD': 50,
    // USDT family
    'mUSDT': 100,
    'aUSDT': 90,
    'USDT': 80,
    // ETH family
    'aETH': 90,
    'ETH': 80,
    // BTC family
    'aBTC': 90,
    'BTC': 80,
  };

  const rank = (pool: PoolConfig) => (priority[pool.currency0.symbol] || 0) + (priority[pool.currency1.symbol] || 0);

  matches.sort((p1, p2) => rank(p2) - rank(p1));
  return matches[0];
}

export function getPoolById(poolId: string, networkModeOverride?: NetworkMode): PoolConfig | null {
  return getPoolsConfig(networkModeOverride).pools.find(pool => pool.id === poolId) || null;
}

// Create Token SDK instances
export function createTokenSDK(tokenSymbol: string, chainId: number, networkModeOverride?: NetworkMode): Token | null {
  const tokenConfig = getToken(tokenSymbol, networkModeOverride);
  if (!tokenConfig) {
    console.log(`[createTokenSDK] No token config found for ${tokenSymbol}`);
    return null;
  }

  try {
    const checksummedAddress = getAddress(tokenConfig.address);

    const token = new Token(
      chainId,
      checksummedAddress,
      tokenConfig.decimals,
      tokenConfig.symbol
    );

    return token;
  } catch (error) {
    console.error(`[createTokenSDK] Error creating token for ${tokenSymbol}:`, error);
    return null;
  }
}

// Get pool configuration for two tokens
export function getPoolConfigForTokens(fromToken: string, toToken: string, networkModeOverride?: NetworkMode) {
  const pool = getPoolByTokens(fromToken, toToken, networkModeOverride);
  if (!pool) return null;

  const fromTokenConfig = getToken(fromToken, networkModeOverride);
  const toTokenConfig = getToken(toToken, networkModeOverride);

  if (!fromTokenConfig || !toTokenConfig) return null;

  return {
    pool,
    fromToken: fromTokenConfig,
    toToken: toTokenConfig
  };
}

// Helper to create pool key from pool config
export function createPoolKeyFromConfig(pool: PoolConfig) {
  return {
    currency0: getAddress(pool.currency0.address),
    currency1: getAddress(pool.currency1.address),
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: getAddress(pool.hooks)
  };
}

// Build a canonical PoolKey by ordering currency0/currency1 via Token.sortsBefore
export function createCanonicalPoolKey(tokenA: Token, tokenB: Token, pool: PoolConfig) {
  const currency0 = getAddress(tokenA.sortsBefore(tokenB) ? tokenA.address : tokenB.address);
  const currency1 = getAddress(tokenA.sortsBefore(tokenB) ? tokenB.address : tokenA.address);
  return {
    currency0,
    currency1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: getAddress(pool.hooks)
  };
}

// Get subgraph ID for a pool
export function getPoolSubgraphId(poolId: string, networkModeOverride?: NetworkMode): string | null {
  const pool = getPoolById(poolId, networkModeOverride);
  return pool?.subgraphId || null;
}

// Get contract addresses
export function getContracts(networkModeOverride?: NetworkMode): ContractsConfig {
  return getPoolsConfig(networkModeOverride).contracts;
}

export function getQuoterAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.quoter);
}

export function getUniversalRouterAddress(networkModeOverride?: NetworkMode): Address {
  const config = getPoolsConfig(networkModeOverride);
  if (!config.contracts.universalRouter) {
    throw new Error('Missing contracts.universalRouter in config/pools.json');
  }
  return getAddress(config.contracts.universalRouter);
}

export function getPositionManagerAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.positionManager);
}

export function getStateViewAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.stateView);
}

// Token definitions type for network-aware components
export type TokenDefinitions = Record<string, {
  address: string;
  decimals: number;
  symbol: string;
}>;

// Legacy compatibility - create TOKEN_DEFINITIONS from pools config
// Now dynamically fetched to support network switching
export function getTokenDefinitions(networkModeOverride?: NetworkMode): TokenDefinitions {
  const config = getPoolsConfig(networkModeOverride);
  return Object.fromEntries(
    Object.entries(config.tokens).map(([symbol, token]) => [
      symbol,
      {
        address: token.address,
        decimals: token.decimals,
        symbol: token.symbol
      }
    ])
  );
}

// For backwards compatibility - static export that uses current network mode
// WARNING: This is evaluated at runtime, so it will use the network mode at call time
export const TOKEN_DEFINITIONS = getTokenDefinitions();

export type TokenSymbol = string;

// Utility function to map token addresses to correct symbols from pools config
export function getTokenSymbolByAddress(address: string, networkModeOverride?: NetworkMode): TokenSymbol | null {
  const tokenDefs = getTokenDefinitions(networkModeOverride);
  const normalizedAddress = address.toLowerCase();
  for (const [symbol, tokenConfig] of Object.entries(tokenDefs)) {
    if (tokenConfig.address.toLowerCase() === normalizedAddress) {
      return symbol as TokenSymbol;
    }
  }
  return null;
}

// Export chain info as functions for dynamic network support
export function getChainId(networkModeOverride?: NetworkMode): number {
  return getPoolsConfig(networkModeOverride).meta.chainId;
}

export function getChainName(networkModeOverride?: NetworkMode): string {
  return getPoolsConfig(networkModeOverride).meta.chainName;
}

// For backwards compatibility - WARNING: these are evaluated once at module load
export const CHAIN_ID = getChainId();
export const CHAIN_NAME = getChainName();
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'; 