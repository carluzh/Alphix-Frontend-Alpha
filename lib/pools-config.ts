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
  const tokenConfig = getToken(tokenSymbol);
  if (!tokenConfig) return null;
  
  return new Token(
    chainId,
    getAddress(tokenConfig.address),
    tokenConfig.decimals,
    tokenConfig.symbol
  );
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
  addressRaw: string;
  decimals: number;
  symbol: string;
  displayDecimals: number;
}> = Object.fromEntries(
  Object.entries(poolsConfig.tokens).map(([symbol, token]) => [
    symbol,
    {
      addressRaw: token.address,
      decimals: token.decimals,
      symbol: token.symbol,
      displayDecimals: token.displayDecimals
    }
  ])
);

export type TokenSymbol = keyof typeof TOKEN_DEFINITIONS;

// Export chain info
export const CHAIN_ID = poolsConfig.meta.chainId;
export const CHAIN_NAME = poolsConfig.meta.chainName; 