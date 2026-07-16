// Subgraph URL resolution per chain. Env vars per chain are required.
// Base: SUBGRAPH_URL_BASE_LVRFEE (lean lvrfee subgraph indexes ALL Base pools).
// Arbitrum: SUBGRAPH_URL_ARBITRUM_ALPHIX.

import { type NetworkMode } from './network-mode';
import type { PoolConfig } from './pools-config';

function resolveSubgraphUrl(mode: NetworkMode): string {
  switch (mode) {
    case 'base': {
      const url = process.env.SUBGRAPH_URL_BASE_LVRFEE;
      if (!url) throw new Error('SUBGRAPH_URL_BASE_LVRFEE env var is required for Base');
      return url;
    }
    case 'arbitrum': {
      const url = process.env.SUBGRAPH_URL_ARBITRUM_ALPHIX;
      if (!url) throw new Error('SUBGRAPH_URL_ARBITRUM_ALPHIX env var is required for Arbitrum');
      return url;
    }
  }
}

/** Primary Alphix subgraph URL for a network. */
export function getAlphixSubgraphUrl(networkMode: NetworkMode): string {
  return resolveSubgraphUrl(networkMode);
}

/** Return the correct subgraph URL for a specific pool.
 *  Each network has a single subgraph indexing all of its pools. */
export function getSubgraphUrlForPool(pool: PoolConfig, networkMode: NetworkMode): string {
  return resolveSubgraphUrl(networkMode);
}

/** Return all subgraph URLs for a network (one per network). */
export function getAllAlphixSubgraphUrls(networkMode: NetworkMode): string[] {
  return [resolveSubgraphUrl(networkMode)];
}

export function isBaseSubgraphMode(networkMode: NetworkMode): boolean {
  return networkMode === 'base';
}
