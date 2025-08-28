import { createPublicClient, http, fallback } from 'viem';
import { getTargetChain } from './swap-constants';
import { baseSepolia } from './wagmiConfig';

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

// Create a fallback transport with multiple RPC endpoints
const transport = fallback(
  RPC_URLS.map(url => http(url, {
    timeout: 12000, // 12s per endpoint
    retryCount: 1,  // minimal retries to avoid long cascades
    retryDelay: 800  // short delay
  }))
);

export const publicClient = createPublicClient({
    chain: baseSepolia,
    transport,
});

// You can also export the chain object if it's needed elsewhere directly
export { baseSepolia as targetChain }; 