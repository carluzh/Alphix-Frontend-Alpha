// Helper to determine which subgraph URL to use for a given pool
// DAI pools use a separate subgraph (SUBGRAPH_URL_DAI) on testnet
// Mainnet uses dual-subgraph architecture:
//   - Alphix subgraph: HookPosition, AlphixHook entities
//   - Uniswap v4 subgraph: Pool, PoolDayData, Token entities

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

// DAI pools on testnet (not applicable to mainnet)
const DAI_POOL_IDS = [
  'ausdc-adai',
  'adai-aeth',
  '0x4bd4386e6ef583af6cea0e010a7118f41c4d3315e88b81a88fc7fd3822bf766b', // ausdc-adai subgraphId
  '0x47da32fed07f99dc9a10744a58f43bf563909d8b46203c300487caf3edd8b1f3', // adai-aeth subgraphId
];

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
 * Returns the base subgraph URL based on current network mode.
 * @deprecated Use getAlphixSubgraphUrl() or getUniswapV4SubgraphUrl() for clarity
 */
export function getBaseSubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    return process.env.SUBGRAPH_URL_MAINNET_ALPHIX || process.env.SUBGRAPH_URL || '';
  }
  return process.env.SUBGRAPH_URL || '';
}

/**
 * Returns the DAI subgraph URL based on current network mode.
 * Only applicable to testnet - mainnet doesn't have separate DAI pools.
 */
export function getDaiSubgraphUrl(networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') {
    // Mainnet uses single Alphix subgraph for all Alphix entities
    return process.env.SUBGRAPH_URL_MAINNET_ALPHIX || '';
  }
  return process.env.SUBGRAPH_URL_DAI || process.env.SUBGRAPH_URL || '';
}

/**
 * Returns the appropriate subgraph URL for Alphix entities (HookPosition, AlphixHook).
 * Network-aware: handles DAI pool separation on testnet.
 */
export function getSubgraphUrlForPool(poolId: string | undefined, networkModeOverride?: NetworkMode): string {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();

  // Mainnet: all Alphix entities go to the minimal subgraph
  if (networkMode === 'mainnet') {
    return getAlphixSubgraphUrl(networkMode);
  }

  // Testnet: DAI pools use separate subgraph
  if (poolId) {
    const normalizedPoolId = poolId.toLowerCase();
    const isDaiPoolId = DAI_POOL_IDS.some(id => normalizedPoolId === id.toLowerCase());
    if (isDaiPoolId) {
      return getDaiSubgraphUrl(networkMode);
    }
  }

  return process.env.SUBGRAPH_URL || '';
}

/**
 * Check if a pool ID is a DAI pool (testnet only)
 */
export function isDaiPool(poolId: string | undefined, networkModeOverride?: NetworkMode): boolean {
  if (!poolId) return false;
  // DAI pool separation only exists on testnet
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  if (networkMode === 'mainnet') return false;
  const normalizedPoolId = poolId.toLowerCase();
  return DAI_POOL_IDS.some(id => normalizedPoolId === id.toLowerCase());
}

/**
 * Check if we're in mainnet mode (for conditional query logic)
 */
export function isMainnetSubgraphMode(networkModeOverride?: NetworkMode): boolean {
  const networkMode = networkModeOverride ?? getDefaultNetworkMode();
  return networkMode === 'mainnet';
}
