import { getAddress, type Address } from 'viem';
import { Token } from '@uniswap/sdk-core';
import basePoolsConfig from '../config/base_pools.json';
import arbitrumPoolsConfig from '../config/arbitrum_pools.json';
import { getStoredNetworkMode, type NetworkMode } from './network-mode';
import { ALL_MODES } from './chain-registry';

export type { NetworkMode };

interface PoolsConfigFile {
  meta: { chainId: number; chainName: string };
  contracts: { poolManager: string; universalRouter?: string; quoter: string; positionManager: string; stateView: string };
  hooks: { alphixHookId: string };
  tokens: Record<string, { symbol: string; name: string; address: string; decimals: number; icon: string; color?: string }>;
  pools: Array<{
    slug: string;
    name: string;
    poolId: string;
    currency0: { symbol: string; address: string };
    currency1: { symbol: string; address: string };
    fee: number;
    tickSpacing: number;
    hooks: string;
    enabled: boolean;
    featured: boolean;
    type?: string;
    yieldSources?: Array<'aave' | 'spark'>;
    rehypoRange?: { min: string; max: string; isFullRange: boolean };
  }>;
}

const CONFIG_MAP: Record<NetworkMode, PoolsConfigFile> = {
  base: basePoolsConfig as PoolsConfigFile,
  arbitrum: arbitrumPoolsConfig as PoolsConfigFile,
};

/** Resolved mode for a given override */
function resolveMode(networkModeOverride?: NetworkMode): NetworkMode {
  return networkModeOverride ?? getStoredNetworkMode();
}

/** Get raw config file (tokens, contracts, fees) */
function getPoolsConfig(networkModeOverride?: NetworkMode): PoolsConfigFile {
  const mode = resolveMode(networkModeOverride);
  return CONFIG_MAP[mode] ?? CONFIG_MAP.base;
}

/** Get pools array with networkMode tagged on each pool */
function getTaggedPools(networkModeOverride?: NetworkMode): PoolConfig[] {
  const mode = resolveMode(networkModeOverride);
  const config = CONFIG_MAP[mode] ?? CONFIG_MAP.base;
  return config.pools.map(pool => ({ ...pool, networkMode: mode }));
}

export interface TokenConfig {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
  color?: string;
}

export interface PoolCurrency {
  symbol: string;
  address: string;
}

export interface RehypoRangeConfig {
  min: string;
  max: string;
  isFullRange: boolean;
}

export type YieldSource = 'aave' | 'spark';

export interface PoolConfig {
  slug: string;
  name: string;
  poolId: string;
  currency0: PoolCurrency;
  currency1: PoolCurrency;
  fee: number;
  tickSpacing: number;
  hooks: string;
  enabled: boolean;
  featured: boolean;
  type?: string;
  yieldSources?: YieldSource[];
  rehypoRange?: RehypoRangeConfig;
  networkMode: NetworkMode;
}

export interface ContractsConfig {
  poolManager: string;
  universalRouter?: string;
  quoter: string;
  positionManager: string;
  stateView: string;
}

export function getAllTokens(networkModeOverride?: NetworkMode): Record<string, TokenConfig> {
  return getPoolsConfig(networkModeOverride).tokens;
}

export function getAllTokenSymbols(networkModeOverride?: NetworkMode): string[] {
  return Object.keys(getAllTokens(networkModeOverride));
}

export function getToken(symbol: string, networkModeOverride?: NetworkMode): TokenConfig | null {
  const config = getPoolsConfig(networkModeOverride);
  return config.tokens[symbol as keyof typeof config.tokens] || null;
}

/**
 * Known token icon paths. Icons live in public/tokens/ and are chain-independent.
 * If a token has an icon file, it works on every chain — no config lookup needed.
 */
const TOKEN_ICONS: Record<string, string> = {
  ETH: '/tokens/ETH.png',
  WETH: '/tokens/ETH.png',
  USDC: '/tokens/USDC.png',
  USDS: '/tokens/USDS.png',
  USDT: '/tokens/USDT.png',
  aETH: '/tokens/aETH.png',
  aUSDC: '/tokens/aUSDC.png',
  aUSDT: '/tokens/aUSDT.png',
  aDAI: '/tokens/aDAI.png',
  aBTC: '/tokens/aBTC.png',
  cbBTC: '/tokens/cbBTC.svg',
};

/** Resolve a token icon by symbol. Chain-independent — icons are static assets. */
export function resolveTokenIcon(symbol: string): string {
  if (!symbol) return '/tokens/placeholder.svg';
  return TOKEN_ICONS[symbol] ?? '/tokens/placeholder.svg';
}

export function getTokenDecimals(symbol: string, networkModeOverride?: NetworkMode): number | null {
  const token = getToken(symbol, networkModeOverride);
  return token?.decimals || null;
}

export function getAllPools(networkModeOverride?: NetworkMode): PoolConfig[] {
  return getTaggedPools(networkModeOverride);
}

export function getEnabledPools(networkModeOverride?: NetworkMode): PoolConfig[] {
  return getTaggedPools(networkModeOverride).filter(pool => pool.enabled);
}

const PRODUCTION_MODES = ALL_MODES;

/** Get tokens from ALL chains (deduped by symbol, base takes priority) */
export function getMultiChainTokens(): Record<string, TokenConfig> {
  const merged: Record<string, TokenConfig> = {};
  for (const mode of PRODUCTION_MODES) {
    const tokens = getPoolsConfig(mode).tokens;
    for (const [symbol, token] of Object.entries(tokens)) {
      if (!merged[symbol]) merged[symbol] = token;
    }
  }
  return merged;
}

export function getMultiChainEnabledPools(): PoolConfig[] {
  return PRODUCTION_MODES.flatMap(mode =>
    getTaggedPools(mode).filter(pool => pool.enabled)
  );
}

export function getPoolByTokens(tokenA: string, tokenB: string, networkModeOverride?: NetworkMode): PoolConfig | null {
  const pools = getTaggedPools(networkModeOverride);
  const matches = pools.filter(pool => {
    const a = pool.currency0.symbol;
    const b = pool.currency1.symbol;
    return (a === tokenA && b === tokenB) || (a === tokenB && b === tokenA);
  });

  if (matches.length === 0) return null;

  // When multiple pools match the same token pair, rank by stablecoin preference
  const priority: Record<string, number> = {
    'USDC': 100,
    'USDT': 100,
    'USDS': 95,
    'ETH': 80,
  };

  const rank = (pool: PoolConfig) => (priority[pool.currency0.symbol] || 0) + (priority[pool.currency1.symbol] || 0);

  matches.sort((p1, p2) => rank(p2) - rank(p1));
  return matches[0];
}

/** Look up a pool by slug ("eth-usdc") or poolId hash ("0xebb6...") */
export function getPoolBySlug(slug: string, networkModeOverride?: NetworkMode): PoolConfig | null {
  const pools = getTaggedPools(networkModeOverride);
  return pools.find(pool => pool.slug === slug)
    || pools.find(pool => pool.poolId?.toLowerCase() === slug.toLowerCase())
    || null;
}

export function getPoolBySlugMultiChain(slug: string): PoolConfig | null {
  for (const mode of PRODUCTION_MODES) {
    const pool = getPoolBySlug(slug, mode);
    if (pool) return pool;
  }
  return null;
}

export function createTokenSDK(tokenSymbol: string, chainId: number, networkModeOverride?: NetworkMode): Token | null {
  const tokenConfig = getToken(tokenSymbol, networkModeOverride);
  if (!tokenConfig) {
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

export function createPoolKeyFromConfig(pool: PoolConfig) {
  return {
    currency0: getAddress(pool.currency0.address),
    currency1: getAddress(pool.currency1.address),
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: getAddress(pool.hooks)
  };
}

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

export function getPoolId(slug: string, networkModeOverride?: NetworkMode): string | null {
  const pool = getPoolBySlug(slug, networkModeOverride);
  return pool?.poolId || null;
}

export function getQuoterAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.quoter);
}

export function getUniversalRouterAddress(networkModeOverride?: NetworkMode): Address {
  const config = getPoolsConfig(networkModeOverride);
  if (!config.contracts.universalRouter) {
    throw new Error('Missing contracts.universalRouter in pool config');
  }
  return getAddress(config.contracts.universalRouter);
}

export function getPositionManagerAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.positionManager);
}

export function getStateViewAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.stateView);
}

export function getPoolManagerAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.poolManager);
}

export function getHooksAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).hooks.alphixHookId);
}

export type TokenDefinitions = Record<string, {
  address: string;
  decimals: number;
  symbol: string;
}>;

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

/** @deprecated Use getTokenDefinitions(mode) for chain-aware usage */
export const TOKEN_DEFINITIONS = getTokenDefinitions();

export type TokenSymbol = string;

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

export function getChainId(networkModeOverride?: NetworkMode): number {
  return getPoolsConfig(networkModeOverride).meta.chainId;
}

export function getChainName(networkModeOverride?: NetworkMode): string {
  return getPoolsConfig(networkModeOverride).meta.chainName;
}

/** @deprecated Use getChainId(mode) for chain-aware usage */
export const CHAIN_ID = getChainId();
/** @deprecated Use getChainName(mode) for chain-aware usage */
export const CHAIN_NAME = getChainName();
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'; 