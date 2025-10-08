// Helper to determine which subgraph URL to use for a given pool
// DAI pools use a separate subgraph (SUBGRAPH_URL_DAI)

const DAI_POOL_IDS = [
  'ausdc-adai',
  'adai-aeth',
  '0x4bd4386e6ef583af6cea0e010a7118f41c4d3315e88b81a88fc7fd3822bf766b', // ausdc-adai subgraphId
  '0x47da32fed07f99dc9a10744a58f43bf563909d8b46203c300487caf3edd8b1f3', // adai-aeth subgraphId
];

/**
 * Returns the appropriate subgraph URL for a given pool ID.
 * DAI pools use SUBGRAPH_URL_DAI, all others use SUBGRAPH_URL.
 */
export function getSubgraphUrlForPool(poolId: string | undefined): string {
  if (!poolId) {
    return process.env.SUBGRAPH_URL || '';
  }

  const normalizedPoolId = poolId.toLowerCase();
  const isDaiPool = DAI_POOL_IDS.some(id => normalizedPoolId === id.toLowerCase());

  if (isDaiPool) {
    return process.env.SUBGRAPH_URL_DAI || process.env.SUBGRAPH_URL || '';
  }

  return process.env.SUBGRAPH_URL || '';
}

/**
 * Check if a pool ID is a DAI pool
 */
export function isDaiPool(poolId: string | undefined): boolean {
  if (!poolId) return false;
  const normalizedPoolId = poolId.toLowerCase();
  return DAI_POOL_IDS.some(id => normalizedPoolId === id.toLowerCase());
}
