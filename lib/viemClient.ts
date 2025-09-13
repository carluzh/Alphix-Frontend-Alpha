import { createPublicClient, http, fallback, custom } from 'viem';
import { getTargetChain } from './swap-constants';
import { baseSepolia } from './wagmiConfig';
import { executeRPCCall, executeRPCBatch } from './rpcClient';

// Multiple RPC endpoints for better reliability
const RPC_URLS = [
  process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL,
  // Prefer the official endpoint first
  "https://sepolia.base.org",
  // Keep one reliable fallback
  "https://base-sepolia.drpc.org",
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
    chain: baseSepolia,
    transport,
    // Ensure viem knows about multicall, otherwise fallback to individual calls
    batch: {
      multicall: true,
    },
});

// You can also export the chain object if it's needed elsewhere directly
export { baseSepolia as targetChain }; 