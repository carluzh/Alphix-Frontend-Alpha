import { createPublicClient, http, fallback, custom, type PublicClient, type Chain } from 'viem';
import { activeChain, baseSepolia, baseMainnet, isMainnet } from './wagmiConfig';
import { executeRPCCall, executeRPCBatch } from './rpcClient';
import { type NetworkMode } from './network-mode';

// Network-specific RPC endpoints
const TESTNET_RPC_URLS = [
  "https://sepolia.base.org",
  "https://base-sepolia.drpc.org",
];

const MAINNET_RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.drpc.org",
];

// Get RPC URLs for a specific network mode
function getRpcUrlsForNetwork(networkMode: NetworkMode): string[] {
  const customRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL;
  const networkUrls = networkMode === 'mainnet' ? MAINNET_RPC_URLS : TESTNET_RPC_URLS;
  return [customRpcUrl, ...networkUrls].filter(Boolean) as string[];
}

// Multiple RPC endpoints for better reliability - use network-aware URLs (for default client)
const RPC_URLS = [
  process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL,
  ...(isMainnet ? MAINNET_RPC_URLS : TESTNET_RPC_URLS),
].filter(Boolean) as string[];

if (RPC_URLS.length === 0) {
    throw new Error("No RPC URLs are defined. Please set NEXT_PUBLIC_RPC_URL or RPC_URL environment variable.");
}

// Custom rate-limited transport
const rateLimitedTransport = custom({
  async request({ method, params }) {
    // Try each RPC URL in order until one succeeds
    let lastError: Error | undefined;

    for (const rpcUrl of RPC_URLS) {
      try {
        return await executeRPCCall(rpcUrl, {
          method,
          params: params as any[],
        }, {
          timeout: 10000,
          maxRetries: 1,
        });
      } catch (error) {
        lastError = error as Error;
        console.warn(`[RPC] ${rpcUrl} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        continue;
      }
    }

    throw lastError || new Error('All RPC endpoints failed');
  },
});

// Fallback transport for comparison (original implementation)
const fallbackTransport = fallback(
  RPC_URLS.map(url => http(url, {
    timeout: 12000, // 12s per endpoint
    retryCount: 1,  // minimal retries to avoid long cascades
    retryDelay: 800  // short delay
  }))
);

// Use rate-limited transport by default
const transport = process.env.USE_RATE_LIMITED_RPC === 'true' ? rateLimitedTransport : fallbackTransport;

export const publicClient = createPublicClient({
    chain: activeChain,
    transport,
    // Ensure viem knows about multicall, otherwise fallback to individual calls
    batch: {
      multicall: true,
    },
});

// Export the active chain object
export { activeChain as targetChain };

// Legacy export for backwards compatibility
export { baseSepolia };

/**
 * Create a public client for a specific network mode.
 * Use this in API routes where network mode comes from request cookies.
 */
export function createNetworkClient(networkMode: NetworkMode): PublicClient {
  const rpcUrls = getRpcUrlsForNetwork(networkMode);
  const chain = networkMode === 'mainnet' ? baseMainnet : baseSepolia;

  const networkTransport = fallback(
    rpcUrls.map(url => http(url, {
      timeout: 12000,
      retryCount: 1,
      retryDelay: 800
    }))
  );

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

  // Check if custom URL is set and matches the requested network
  if (customRpcUrl) {
    const isMainnetUrl = customRpcUrl.includes('mainnet') ||
                         customRpcUrl.includes('base.g.alchemy') ||
                         customRpcUrl.includes('base-mainnet');
    const isTestnetUrl = customRpcUrl.includes('sepolia') ||
                         customRpcUrl.includes('testnet');

    // Use custom URL only if it matches the requested network
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