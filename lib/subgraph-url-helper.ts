/**
 * Subgraph URL Helper
 *
 * Architecture:
 * - TESTNET (Base Sepolia): Single unified subgraph (SUBGRAPH_URL)
 *   Contains: Pool, HookPosition, UnifiedYieldPosition, AlphixHook, AlphixHookTVL, etc.
 *
 * - MAINNET (Base): Single unified subgraph (SUBGRAPH_URL_MAINNET_ALPHIX)
 *   Contains all entities like testnet - Pool, PoolDayData, HookPosition,
 *   UnifiedYieldPosition, AlphixHook, AlphixHookTVL, etc.
 *
 * Note: UNISWAP_V4_SUBGRAPH_URL is only needed if querying non-Alphix pools.
 * Since we only query Alphix pools, the Alphix subgraph is used for all queries.
 */

import { getStoredNetworkMode, type NetworkMode } from './network-mode';

/**
 * Get the default network mode for this module.
 * On server: use env var default (mainnet for production)
 * On client: check localStorage, then env var
 */
function getDefaultNetworkMode(): NetworkMode {
  if (typeof window === 'undefined') {
    // Server-side: use env var default
    const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
    return envDefault === 'mainnet' ? 'mainnet' : 'testnet';
  }
  // Client-side: use full logic with localStorage
  return getStoredNetworkMode();
}

/**
 * Returns the Alphix subgraph URL for HookPosition and AlphixHook queries.
 * - Testnet: Uses SUBGRAPH_URL (full subgraph)
 * - Mainnet: Uses SUBGRAPH_URL_MAINNET_ALPHIX (minimal subgraph)
 */
export function getAlphixSubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    return process.env.SUBGRAPH_URL_MAINNET_ALPHIX || '';
  }
  return process.env.SUBGRAPH_URL || '';
}

/**
 * Returns the subgraph URL for Pool/PoolDayData queries.
 * - Testnet: Uses SUBGRAPH_URL (unified subgraph)
 * - Mainnet: Uses SUBGRAPH_URL_MAINNET_ALPHIX (unified subgraph with all entities)
 *
 * Note: Both networks now use a unified Alphix subgraph that contains
 * Pool, PoolDayData, and all other entities. The Uniswap public subgraph
 * (UNISWAP_V4_SUBGRAPH_URL) is only needed for non-Alphix pool data.
 */
export function getUniswapV4SubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    // Unified Alphix subgraph contains Pool/PoolDayData for Alphix pools
    return process.env.SUBGRAPH_URL_MAINNET_ALPHIX || '';
  }
  // Testnet: unified subgraph has all entities
  return process.env.SUBGRAPH_URL || '';
}

/**
 * Check if we're in mainnet mode (for conditional query logic)
 */
export function isMainnetSubgraphMode(networkModeOverride?: NetworkMode): boolean {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  return networkMode === 'mainnet';
}

// Goldsky fallback for mainnet (free public endpoint)
const GOLDSKY_MAINNET_URL = 'https://api.goldsky.com/api/public/project_cmktm2w8l5s0k01u9fz2yetrw/subgraphs/alphix-hook-mainnet/1.0.0/gn';

/**
 * Returns an array of subgraph URLs to try in order (primary + fallbacks).
 * Used by subgraphClient for automatic failover.
 */
export function getSubgraphUrlsWithFallback(networkModeOverride?: NetworkMode): string[] {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  const urls: string[] = [];

  if (networkMode === 'mainnet') {
    const primary = process.env.SUBGRAPH_URL_MAINNET_ALPHIX;
    if (primary) urls.push(primary);
    urls.push(GOLDSKY_MAINNET_URL);
  } else {
    const primary = process.env.SUBGRAPH_URL;
    if (primary) urls.push(primary);
  }

  return urls.filter(Boolean);
}
