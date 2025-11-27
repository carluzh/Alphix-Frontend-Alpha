// Helper to determine which subgraph URL to use for a given pool
// DAI pools use a separate subgraph (SUBGRAPH_URL_DAI)
// Mainnet uses different subgraph URLs

import { getStoredNetworkMode } from './network-mode';

const DAI_POOL_IDS = [
  'ausdc-adai',
  'adai-aeth',
  '0x4bd4386e6ef583af6cea0e010a7118f41c4d3315e88b81a88fc7fd3822bf766b', // ausdc-adai subgraphId
  '0x47da32fed07f99dc9a10744a58f43bf563909d8b46203c300487caf3edd8b1f3', // adai-aeth subgraphId
];

/**
 * Returns the base subgraph URL based on current network mode.
 */
export function getBaseSubgraphUrl(): string {
  const networkMode = getStoredNetworkMode();
  if (networkMode === 'mainnet') {
    // TODO: Update with actual mainnet subgraph URL when deployed
    return process.env.SUBGRAPH_URL_MAINNET || process.env.SUBGRAPH_URL || '';
  }
  return process.env.SUBGRAPH_URL || '';
}

/**
 * Returns the DAI subgraph URL based on current network mode.
 */
export function getDaiSubgraphUrl(): string {
  const networkMode = getStoredNetworkMode();
  if (networkMode === 'mainnet') {
    // TODO: Update with actual mainnet DAI subgraph URL when deployed
    return process.env.SUBGRAPH_URL_DAI_MAINNET || process.env.SUBGRAPH_URL_MAINNET || process.env.SUBGRAPH_URL || '';
  }
  return process.env.SUBGRAPH_URL_DAI || process.env.SUBGRAPH_URL || '';
}

/**
 * Returns the appropriate subgraph URL for a given pool ID.
 * DAI pools use SUBGRAPH_URL_DAI, all others use SUBGRAPH_URL.
 * Network-aware: uses mainnet URLs when in mainnet mode.
 */
export function getSubgraphUrlForPool(poolId: string | undefined): string {
  if (!poolId) {
    return getBaseSubgraphUrl();
  }

  const normalizedPoolId = poolId.toLowerCase();
  const isDaiPoolId = DAI_POOL_IDS.some(id => normalizedPoolId === id.toLowerCase());

  if (isDaiPoolId) {
    return getDaiSubgraphUrl();
  }

  return getBaseSubgraphUrl();
}

/**
 * Check if a pool ID is a DAI pool
 */
export function isDaiPool(poolId: string | undefined): boolean {
  if (!poolId) return false;
  const normalizedPoolId = poolId.toLowerCase();
  return DAI_POOL_IDS.some(id => normalizedPoolId === id.toLowerCase());
}
