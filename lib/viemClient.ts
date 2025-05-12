import { createPublicClient, http } from 'viem';
import { getTargetChain } from './swap-constants';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || "https://unichain-sepolia.drpc.org";

if (!RPC_URL) {
    throw new Error("RPC_URL is not defined in environment variables. Please set NEXT_PUBLIC_RPC_URL or RPC_URL.");
}

const targetChain = getTargetChain(RPC_URL);

export const publicClient = createPublicClient({
    chain: targetChain,
    transport: http(), // transport will use the rpcUrls.default.http from targetChain
});

// You can also export the chain object if it's needed elsewhere directly
export { targetChain }; 