import { createPublicClient, custom, fallback, http, type PublicClient, type Chain } from 'viem';
import { getOrderedRpcUrls, getChainForMode } from './chains';
import { type NetworkMode } from './network-mode';
import { AppRpcClient } from './rpc/AppRpcClient';

// Per-chain client cache — avoids creating new clients on every call
const clientCache = new Map<NetworkMode, PublicClient>();

/** Get or create a cached public client for a network mode. */
export function createNetworkClient(networkMode: NetworkMode): PublicClient {
  const cached = clientCache.get(networkMode);
  if (cached) return cached;

  const chain = getChainForMode(networkMode);
  const rpcClient = new AppRpcClient(getOrderedRpcUrls(chain), {
    minimumBackoffTime: 3000,
    timeout: 10000,
  });

  const client = createPublicClient({
    chain,
    transport: custom({
      async request({ method, params }) {
        return rpcClient.request({ method, params: params as unknown[] });
      },
    }),
    batch: { multicall: true },
  });

  clientCache.set(networkMode, client);
  return client;
}

/** @deprecated Use createNetworkClient(mode) instead */
export const publicClient = createNetworkClient('base');

/** @deprecated Use getChainForMode(mode) instead */
export const targetChain = getChainForMode('base');

export function getChainForNetwork(networkMode: NetworkMode): Chain {
  return getChainForMode(networkMode);
}

export function getRpcUrlForNetwork(networkMode: NetworkMode): string {
  return getOrderedRpcUrls(getChainForMode(networkMode))[0];
}

export function createFallbackTransport(chain: Chain) {
  const urls = getOrderedRpcUrls(chain);
  return fallback(urls.map(url => http(url, { timeout: 10_000 })));
}
