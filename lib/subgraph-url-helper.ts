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

// Goldsky-hosted subgraph URLs
// Mainnet: MUST be set via SUBGRAPH_URL_MAINNET_ALPHIX env var (no hardcoded fallback)
// Testnet: Goldsky fallback for development convenience
const GOLDSKY_TESTNET_URL = 'https://api.goldsky.com/api/public/project_cmktm2w8l5s0k01u9fz2yetrw/subgraphs/alphix-hook-testnet/0.0.7/gn';

/**
 * OVERRIDE: Always use mainnet (testnet removed)
 */
function getDefaultNetworkMode(): NetworkMode {
  return 'mainnet';
}

/**
 * Returns the Alphix subgraph URL for HookPosition and AlphixHook queries.
 * Mainnet: Requires SUBGRAPH_URL_MAINNET_ALPHIX env var
 * Testnet: Falls back to Goldsky if env var is not set
 */
export function getAlphixSubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    const mainnetUrl = process.env.SUBGRAPH_URL_MAINNET_ALPHIX;
    if (!mainnetUrl) {
      throw new Error('SUBGRAPH_URL_MAINNET_ALPHIX env var is required for mainnet');
    }
    return mainnetUrl;
  }
  return process.env.SUBGRAPH_URL || GOLDSKY_TESTNET_URL;
}

/**
 * Returns the subgraph URL for Pool/PoolDayData queries.
 * Mainnet: Requires SUBGRAPH_URL_MAINNET_ALPHIX env var
 * Testnet: Falls back to Goldsky if env var is not set
 */
export function getUniswapV4SubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    const mainnetUrl = process.env.SUBGRAPH_URL_MAINNET_ALPHIX;
    if (!mainnetUrl) {
      throw new Error('SUBGRAPH_URL_MAINNET_ALPHIX env var is required for mainnet');
    }
    return mainnetUrl;
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
