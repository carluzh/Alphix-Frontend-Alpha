import { getAddress, type Address } from 'viem';
import { Token } from '@uniswap/sdk-core';
import poolsConfig from '../config/pools.json';

// Types based on pools.json structure
export interface TokenConfig {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  displayDecimals: number;
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
  quoter: string;
  positionManager: string;
  stateView: string;
}

// Utility functions
export function getAllTokens(): Record<string, TokenConfig> {
  return poolsConfig.tokens;
}

export function getToken(symbol: string): TokenConfig | null {
  return poolsConfig.tokens[symbol as keyof typeof poolsConfig.tokens] || null;
}

export function getTokenDecimals(symbol: string): number | null {
  const token = getToken(symbol);
  return token?.decimals || null;
}

export function getAllPools(): PoolConfig[] {
  return poolsConfig.pools;
}

export function getEnabledPools(): PoolConfig[] {
  return poolsConfig.pools.filter(pool => pool.enabled);
}

export function getFeaturedPools(): PoolConfig[] {
  return poolsConfig.pools.filter(pool => pool.featured && pool.enabled);
}

export function getPoolByTokens(tokenA: string, tokenB: string): PoolConfig | null {
  // Try both orders since pool currencies are ordered
  const pool1 = poolsConfig.pools.find(pool => 
    (pool.currency0.symbol === tokenA && pool.currency1.symbol === tokenB) ||
    (pool.currency0.symbol === tokenB && pool.currency1.symbol === tokenA)
  );
  
  return pool1 || null;
}

export function getPoolById(poolId: string): PoolConfig | null {
  return poolsConfig.pools.find(pool => pool.id === poolId) || null;
}

// Create Token SDK instances
export function createTokenSDK(tokenSymbol: string, chainId: number): Token | null {
  console.log(`[createTokenSDK] Creating token for symbol: ${tokenSymbol}, chainId: ${chainId}`);
  
  const tokenConfig = getToken(tokenSymbol);
  console.log(`[createTokenSDK] Token config found:`, tokenConfig);
  
  if (!tokenConfig) {
    console.log(`[createTokenSDK] No token config found for ${tokenSymbol}`);
    return null;
  }
  
  // REVERTED: Removed logic to override address for native ETH
  // const tokenAddressForSDK = tokenSymbol === 'ETH' ? NATIVE_TOKEN_ADDRESS : tokenConfig.address;

  // REVERTED: Removed debug logs related to `tokenAddressForSDK`
  // console.log(`[createTokenSDK] Raw address from config: ${tokenConfig.address}, type: ${typeof tokenConfig.address}`);
  // console.log(`[createTokenSDK] Address used for SDK: ${tokenAddressForSDK}, type: ${typeof tokenAddressForSDK}`);
  
  try {
    const checksummedAddress = getAddress(tokenConfig.address); // REVERTED to original `tokenConfig.address`
    console.log(`[createTokenSDK] Checksummed address: ${checksummedAddress}, type: ${typeof checksummedAddress}`);
    
    const token = new Token(
      chainId,
      checksummedAddress,
      tokenConfig.decimals,
      tokenConfig.symbol
    );
    
    console.log(`[createTokenSDK] Created token:`, {
      symbol: token.symbol,
      address: token.address,
      addressType: typeof token.address,
      decimals: token.decimals,
      chainId: token.chainId
    });
    
    return token;
  } catch (error) {
    console.error(`[createTokenSDK] Error creating token for ${tokenSymbol}:`, error);
    return null;
  }
}

// Get pool configuration for two tokens
export function getPoolConfigForTokens(fromToken: string, toToken: string) {
  const pool = getPoolByTokens(fromToken, toToken);
  if (!pool) return null;

  const fromTokenConfig = getToken(fromToken);
  const toTokenConfig = getToken(toToken);
  
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

// Get subgraph ID for a pool
export function getPoolSubgraphId(poolId: string): string | null {
  const pool = getPoolById(poolId);
  return pool?.subgraphId || null;
}

// Get contract addresses
export function getContracts(): ContractsConfig {
  return poolsConfig.contracts;
}

export function getQuoterAddress(): Address {
  return getAddress(poolsConfig.contracts.quoter);
}

export function getPositionManagerAddress(): Address {
  return getAddress(poolsConfig.contracts.positionManager);
}

export function getStateViewAddress(): Address {
  return getAddress(poolsConfig.contracts.stateView);
}

// Legacy compatibility - create TOKEN_DEFINITIONS from pools config
export const TOKEN_DEFINITIONS: Record<string, {
  address: string;
  decimals: number;
  symbol: string;
  displayDecimals: number;
}> = Object.fromEntries(
  Object.entries(poolsConfig.tokens).map(([symbol, token]) => [
    symbol,
    {
      address: token.address,
      decimals: token.decimals,
      symbol: token.symbol,
      displayDecimals: token.displayDecimals
    }
  ])
);

export type TokenSymbol = keyof typeof TOKEN_DEFINITIONS;

// Utility function to map token addresses to correct symbols from pools config
export function getTokenSymbolByAddress(address: string): TokenSymbol | null {
  const normalizedAddress = address.toLowerCase();
  for (const [symbol, tokenConfig] of Object.entries(TOKEN_DEFINITIONS)) {
    if (tokenConfig.address.toLowerCase() === normalizedAddress) {
      return symbol as TokenSymbol;
    }
  }
  return null;
}

// Export chain info
export const CHAIN_ID = poolsConfig.meta.chainId;
export const CHAIN_NAME = poolsConfig.meta.chainName;
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'; 