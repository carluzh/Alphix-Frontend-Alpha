// Subgraph URL resolution per chain. Env vars per chain are required.

import { type NetworkMode } from './network-mode';
import { isLvrFeePool } from './liquidity/utils/pool-type-guards';
import type { PoolConfig } from './pools-config';

function resolveSubgraphUrl(mode: NetworkMode): string {
  switch (mode) {
    case 'base': {
      const url = process.env.SUBGRAPH_URL_MAINNET_ALPHIX;
      if (!url) throw new Error('SUBGRAPH_URL_MAINNET_ALPHIX env var is required for Base');
      return url;
    }
    case 'arbitrum': {
      const url = process.env.SUBGRAPH_URL_ARBITRUM_ALPHIX;
      if (!url) throw new Error('SUBGRAPH_URL_ARBITRUM_ALPHIX env var is required for Arbitrum');
      return url;
    }
  }
}

function resolveLvrFeeSubgraphUrl(): string | null {
  return process.env.SUBGRAPH_URL_BASE_LVRFEE || null;
}

/** Primary Alphix subgraph URL for a network. */
export function getAlphixSubgraphUrl(networkMode: NetworkMode): string {
  return resolveSubgraphUrl(networkMode);
}

/** Return the correct subgraph URL for a specific pool. */
export function getSubgraphUrlForPool(pool: PoolConfig, networkMode: NetworkMode): string {
  if (isLvrFeePool(pool)) {
    const lvrFeeUrl = resolveLvrFeeSubgraphUrl();
    if (lvrFeeUrl) return lvrFeeUrl;
  }
  return resolveSubgraphUrl(networkMode);
}

/** Return all subgraph URLs for a network (primary + LVRFee). */
export function getAllAlphixSubgraphUrls(networkMode: NetworkMode): string[] {
  const urls = [resolveSubgraphUrl(networkMode)];
  if (networkMode === 'base') {
    const lvrFeeUrl = resolveLvrFeeSubgraphUrl();
    if (lvrFeeUrl) urls.push(lvrFeeUrl);
  }
  return urls;
}

export function isBaseSubgraphMode(networkMode: NetworkMode): boolean {
  return networkMode === 'base';
}
