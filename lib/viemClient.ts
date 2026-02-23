import { createPublicClient, custom, fallback, http, type PublicClient, type Chain } from 'viem';
// Import from chains.ts (no WalletConnect dependencies) instead of wagmiConfig.ts
import { baseSepolia, baseMainnet, getOrderedRpcUrls } from './chains';
import { type NetworkMode } from './network-mode';
import { AppRpcClient } from './rpc/AppRpcClient';

// OVERRIDE: Always use mainnet (testnet removed)
const activeChain = baseMainnet;

// Get RPC URLs from chains.ts (includes NEXT_PUBLIC_RPC_URL as primary)
const RPC_URLS = getOrderedRpcUrls(baseMainnet);

// AppRpcClient transport with exponential backoff (Uniswap pattern)
// This uses the Controller pattern from Uniswap's AppJsonRpcProvider
// @see interface/apps/web/src/rpc/AppJsonRpcProvider.ts
const appRpcClient = new AppRpcClient(RPC_URLS, {
  minimumBackoffTime: 3000, // L2 block time
  timeout: 10000,
});

const appRpcTransport = custom({
  async request({ method, params }) {
    return appRpcClient.request({ method, params: params as unknown[] });
  },
});

// Use AppRpcClient transport by default (best reliability with exponential backoff)
const transport = appRpcTransport;

export const publicClient = createPublicClient({
    chain: activeChain,
    transport,
    // Ensure viem knows about multicall, otherwise fallback to individual calls
    batch: {
      multicall: true,
    },
});

export { activeChain as targetChain };

// Legacy export for backwards compatibility
export { baseSepolia };

/**
 * Create a public client for a specific network mode.
 * Use this in API routes where network mode comes from request cookies.
 * Uses AppRpcClient with exponential backoff for reliability.
 */
export function createNetworkClient(networkMode: NetworkMode): PublicClient {
  const chain = networkMode === 'mainnet' ? baseMainnet : baseSepolia;
  const rpcUrls = getOrderedRpcUrls(chain);

  // Use AppRpcClient with exponential backoff (Uniswap pattern)
  const networkAppRpcClient = new AppRpcClient(rpcUrls, {
    minimumBackoffTime: 3000, // L2 block time
    timeout: 10000,
  });

  const networkTransport = custom({
    async request({ method, params }) {
      return networkAppRpcClient.request({ method, params: params as unknown[] });
    },
  });

  return createPublicClient({
    chain,
    transport: networkTransport,
    batch: {
      multicall: true,
    },
  });
}

/**
 * Get the chain definition for a specific network mode.
 */
export function getChainForNetwork(networkMode: NetworkMode): Chain {
  return networkMode === 'mainnet' ? baseMainnet : baseSepolia;
}

/**
 * Get the primary RPC URL for a specific network mode.
 */
export function getRpcUrlForNetwork(networkMode: NetworkMode): string {
  const chain = networkMode === 'mainnet' ? baseMainnet : baseSepolia;
  const urls = getOrderedRpcUrls(chain);
  return urls[0];
}

/**
 * Create a fallback transport using the ordered RPC URLs.
 * Useful for one-off clients that need fallback support.
 */
export function createFallbackTransport(chain: Chain) {
  const urls = getOrderedRpcUrls(chain);
  return fallback(urls.map(url => http(url, { timeout: 10_000 })));
}
