import { getAddress, type Address } from 'viem';
import basePoolsConfig from '../config/base_pools.json';
import arbitrumPoolsConfig from '../config/arbitrum_pools.json';
import { getStoredNetworkMode, type NetworkMode } from './network-mode';
import { ALL_MODES } from './chain-registry';

export type { NetworkMode };

interface PoolsConfigFile {
  meta: { chainId: number; chainName: string };
  contracts: { poolManager: string; positionManager: string; stateView: string };
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
    type?: string;
    yieldSources?: Array<'aave'>;
    rehypoRange?: { min: string; max: string; isFullRange: boolean };
    proMeta?: {
      projectName: string;
      hookType: string;
      hookDescription: string;
      isToken0Quote: boolean;
      initialBuyFeeBps: number;
      initialSellFeeBps: number;
      accessManager: string;
      accessManagerAdmin: string;
      feePoker1: string;
      feePoker2: string;
      pauser: string;
    };
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
  return config.pools.map(pool => ({ ...pool, networkMode: mode, proMeta: pool.proMeta as ProMeta | undefined }));
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

interface RehypoRangeConfig {
  min: string;
  max: string;
  isFullRange: boolean;
}

export type YieldSource = 'aave';

export interface ProMeta {
  projectName: string;
  hookType: string;
  hookDescription: string;
  isToken0Quote: boolean;
  initialBuyFeeBps: number;
  initialSellFeeBps: number;
  accessManager: string;
  accessManagerAdmin: string;
  feePoker1: string;
  feePoker2: string;
  pauser: string;
}

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
  type?: string;
  yieldSources?: YieldSource[];
  rehypoRange?: RehypoRangeConfig;
  proMeta?: ProMeta;
  networkMode: NetworkMode;
}

export function getAllTokens(networkModeOverride?: NetworkMode): Record<string, TokenConfig> {
  return getPoolsConfig(networkModeOverride).tokens;
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
  USDT: '/tokens/USDT.png',
  aETH: '/tokens/aETH.png',
  aUSDC: '/tokens/aUSDC.png',
  aUSDT: '/tokens/aUSDT.png',
  aDAI: '/tokens/aDAI.png',
  aBTC: '/tokens/aBTC.png',
  cbBTC: '/tokens/cbBTC.svg',
  ZFI: '/tokens/ZFI.png',
};

/** Resolve a token icon by symbol. Chain-independent — icons are static assets. */
export function resolveTokenIcon(symbol: string): string {
  if (!symbol) return '/tokens/placeholder.svg';
  return TOKEN_ICONS[symbol] ?? '/tokens/placeholder.svg';
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

export function getPoolId(slug: string, networkModeOverride?: NetworkMode): string | null {
  const pool = getPoolBySlug(slug, networkModeOverride);
  return pool?.poolId || null;
}

export function getPositionManagerAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.positionManager);
}

export function getStateViewAddress(networkModeOverride?: NetworkMode): Address {
  return getAddress(getPoolsConfig(networkModeOverride).contracts.stateView);
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

export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';