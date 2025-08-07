import { createPublicClient, http, fallback } from 'viem';
import { getTargetChain } from './swap-constants';
import { baseSepolia } from './wagmiConfig';

// Multiple RPC endpoints for better reliability
const RPC_URLS = [
  process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL,
  "https://base-sepolia.drpc.org",
  "https://sepolia.base.org",
  "https://base-sepolia.publicnode.com",
  "https://1rpc.io/base-sepolia"
].filter(Boolean) as string[];

if (RPC_URLS.length === 0) {
    throw new Error("No RPC URLs are defined. Please set NEXT_PUBLIC_RPC_URL or RPC_URL environment variable.");
}

// Create a fallback transport with multiple RPC endpoints
const transport = fallback(
  RPC_URLS.map(url => http(url, { 
    timeout: 10000, // 10 second timeout
    retryCount: 2,  // Retry up to 2 times
    retryDelay: 1000 // Wait 1 second between retries
  }))
);

export const publicClient = createPublicClient({
    chain: baseSepolia,
    transport,
});

// You can also export the chain object if it's needed elsewhere directly
export { baseSepolia as targetChain }; 