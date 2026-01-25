/**
 * Subgraph URL Helper
 *
 * Architecture:
 * - TESTNET (Base Sepolia): Single unified subgraph (SUBGRAPH_URL)
 *   Contains: Pool, HookPosition, UnifiedYieldPosition, AlphixHook, AlphixHookTVL, etc.
 *
 * - MAINNET (Base): Dual subgraph architecture
 *   1. SUBGRAPH_URL_MAINNET_ALPHIX → Alphix-specific entities (HookPosition, AlphixHook)
 *   2. UNISWAP_V4_SUBGRAPH_URL → Uniswap public subgraph (Pool, PoolDayData, Token)
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
 * Returns the Uniswap v4 subgraph URL for Pool/PoolDayData queries.
 * - Testnet: Uses SUBGRAPH_URL (our full subgraph has these entities)
 * - Mainnet: Uses UNISWAP_V4_SUBGRAPH_URL (public Uniswap subgraph)
 */
export function getUniswapV4SubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    return process.env.UNISWAP_V4_SUBGRAPH_URL || '';
  }
  // Testnet: our full subgraph has Pool/PoolDayData entities
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
const GOLDSKY_MAINNET_URL = 'https://api.goldsky.com/api/public/project_cmh0hxyiq007sw2p20wxl5s79/subgraphs/alphix-mainnet/1.0.0/gn';

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
