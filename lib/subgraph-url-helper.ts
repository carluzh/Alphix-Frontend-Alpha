// Subgraph URL resolution per chain. Env vars per chain are required.

import { type NetworkMode } from './network-mode';

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

export function getAlphixSubgraphUrl(networkMode: NetworkMode): string {
  return resolveSubgraphUrl(networkMode);
}

export function isBaseSubgraphMode(networkMode: NetworkMode): boolean {
  return networkMode === 'base';
}
