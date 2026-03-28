// Subgraph URL resolution per chain. Env vars per chain are required.

import { type NetworkMode } from './network-mode';
import { isVolatilePool } from './liquidity/utils/pool-type-guards';
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

function resolveVolatileSubgraphUrl(): string | null {
  return process.env.SUBGRAPH_URL_BASE_LVRFEE || null;
}

/** Primary Alphix subgraph URL for a network. */
export function getAlphixSubgraphUrl(networkMode: NetworkMode): string {
  return resolveSubgraphUrl(networkMode);
}

/** Return the correct subgraph URL for a specific pool. */
export function getSubgraphUrlForPool(pool: PoolConfig, networkMode: NetworkMode): string {
  if (isVolatilePool(pool)) {
    const volatileUrl = resolveVolatileSubgraphUrl();
    if (volatileUrl) return volatileUrl;
  }
  return resolveSubgraphUrl(networkMode);
}

/** Return all subgraph URLs for a network (primary + Volatile). */
export function getAllAlphixSubgraphUrls(networkMode: NetworkMode): string[] {
  const urls = [resolveSubgraphUrl(networkMode)];
  if (networkMode === 'base') {
    const volatileUrl = resolveVolatileSubgraphUrl();
    if (volatileUrl) urls.push(volatileUrl);
  }
  return urls;
}

export function isBaseSubgraphMode(networkMode: NetworkMode): boolean {
  return networkMode === 'base';
}
