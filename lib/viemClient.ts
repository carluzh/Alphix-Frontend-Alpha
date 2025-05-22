import { createPublicClient, http } from 'viem';
import { getTargetChain } from './swap-constants';
import { baseSepolia } from './wagmiConfig';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || "https://base-sepolia.drpc.org";

if (!RPC_URL) {
    throw new Error("RPC_URL is not defined in environment variables. Please set NEXT_PUBLIC_RPC_URL or RPC_URL.");
}

export const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
});

// You can also export the chain object if it's needed elsewhere directly
export { baseSepolia as targetChain }; 