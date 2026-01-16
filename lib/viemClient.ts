import { createPublicClient, custom, type PublicClient, type Chain } from 'viem';
// Import from chains.ts (no WalletConnect dependencies) instead of wagmiConfig.ts
import { baseSepolia, baseMainnet } from './chains';
import { type NetworkMode, getStoredNetworkMode } from './network-mode';
import { AppRpcClient } from './rpc/AppRpcClient';

// Network-specific RPC endpoints
const TESTNET_RPC_URLS = [
  "https://sepolia.base.org",
  "https://base-sepolia.drpc.org",
];

const MAINNET_RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.drpc.org",
];

// Determine network mode for the default public client
// Server-side: use env var default
// Client-side: check localStorage
const defaultNetworkMode = typeof window === 'undefined'
  ? (process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet')
  : getStoredNetworkMode();
const isMainnet = defaultNetworkMode === 'mainnet';
const activeChain = isMainnet ? baseMainnet : baseSepolia;

function getRpcUrlsForNetwork(networkMode: NetworkMode): string[] {
  const customRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL;
  const networkUrls = networkMode === 'mainnet' ? MAINNET_RPC_URLS : TESTNET_RPC_URLS;

  if (customRpcUrl) {
    const isTestnetUrl = customRpcUrl.includes('sepolia') || customRpcUrl.includes('testnet');
    const isMainnetUrl = customRpcUrl.includes('mainnet') ||
                         customRpcUrl.includes('base.g.alchemy') ||
                         customRpcUrl.includes('base-mainnet');
    const isLocalUrl = customRpcUrl.includes('127.0.0.1') || customRpcUrl.includes('localhost');

    if (isLocalUrl ||
        (networkMode === 'testnet' && isTestnetUrl) ||
        (networkMode === 'mainnet' && isMainnetUrl)) {
      return [customRpcUrl, ...networkUrls];
    }
  }

  return networkUrls;
}

// Alchemy first, public RPCs as fallback
const RPC_URLS = [
  process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL,
  ...(isMainnet ? MAINNET_RPC_URLS : TESTNET_RPC_URLS),
].filter(Boolean) as string[];

if (RPC_URLS.length === 0) {
    throw new Error("No RPC URLs are defined. Please set NEXT_PUBLIC_RPC_URL or RPC_URL environment variable.");
}

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
  const rpcUrls = getRpcUrlsForNetwork(networkMode);
  const chain = networkMode === 'mainnet' ? baseMainnet : baseSepolia;

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
 * Useful for ethers.js providers that need a single URL.
 *
 * Note: Custom RPC URL is only used if it matches the requested network,
 * otherwise we fall back to default public endpoints.
 */
export function getRpcUrlForNetwork(networkMode: NetworkMode): string {
  const customRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL;

  if (customRpcUrl) {
    const isMainnetUrl = customRpcUrl.includes('mainnet') ||
                         customRpcUrl.includes('base.g.alchemy') ||
                         customRpcUrl.includes('base-mainnet');
    const isTestnetUrl = customRpcUrl.includes('sepolia') ||
                         customRpcUrl.includes('testnet');

    if (networkMode === 'mainnet' && (isMainnetUrl || (!isMainnetUrl && !isTestnetUrl))) {
      return customRpcUrl;
    }
    if (networkMode === 'testnet' && isTestnetUrl) {
      return customRpcUrl;
    }
    // Custom URL doesn't match requested network, fall through to defaults
  }

  return networkMode === 'mainnet'
    ? MAINNET_RPC_URLS[0]
    : TESTNET_RPC_URLS[0];
} 