/**
 * Subgraph URL Helper
 *
 * Primary source: Goldsky-hosted Alphix subgraphs (both networks).
 * Env vars (SUBGRAPH_URL / SUBGRAPH_URL_MAINNET_ALPHIX) override Goldsky if set.
 *
 * - TESTNET (Base Sepolia): Goldsky alphix-hook-testnet
 * - MAINNET (Base):         Goldsky alphix-hook-mainnet
 *
 * Both contain all entities: Pool, PoolDayData, HookPosition,
 * UnifiedYieldPosition, AlphixHook, AlphixHookTVL, etc.
 */

import { getStoredNetworkMode, type NetworkMode } from './network-mode';

// Goldsky-hosted subgraph URLs (primary source for both networks)
const GOLDSKY_MAINNET_URL = 'https://api.goldsky.com/api/public/project_cmktm2w8l5s0k01u9fz2yetrw/subgraphs/alphix-hook-mainnet/prod/gn';
const GOLDSKY_TESTNET_URL = 'https://api.goldsky.com/api/public/project_cmktm2w8l5s0k01u9fz2yetrw/subgraphs/alphix-hook-testnet/0.0.7/gn';

/**
 * Get the default network mode for this module.
 * On server: use env var default (mainnet for production)
 * On client: check localStorage, then env var
 */
function getDefaultNetworkMode(): NetworkMode {
  if (typeof window === 'undefined') {
    const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
    return envDefault === 'mainnet' ? 'mainnet' : 'testnet';
  }
  return getStoredNetworkMode();
}

/**
 * Returns the Alphix subgraph URL for HookPosition and AlphixHook queries.
 * Falls back to Goldsky if env var is not set.
 */
export function getAlphixSubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    return process.env.SUBGRAPH_URL_MAINNET_ALPHIX || GOLDSKY_MAINNET_URL;
  }
  return process.env.SUBGRAPH_URL || GOLDSKY_TESTNET_URL;
}

/**
 * Returns the subgraph URL for Pool/PoolDayData queries.
 * Both networks use the unified Alphix Goldsky subgraph.
 */
export function getUniswapV4SubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    return process.env.SUBGRAPH_URL_MAINNET_ALPHIX || GOLDSKY_MAINNET_URL;
  }
  return process.env.SUBGRAPH_URL || GOLDSKY_TESTNET_URL;
}

/**
 * Check if we're in mainnet mode (for conditional query logic)
 */
export function isMainnetSubgraphMode(networkModeOverride?: NetworkMode): boolean {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  return networkMode === 'mainnet';
}
