/**
 * Chain definitions for viem/wagmi
 *
 * This file contains ONLY chain definitions without any wallet adapter imports.
 * This allows server-side code (API routes) to import chains without pulling
 * in WalletConnect dependencies that cause ESM/CommonJS interop issues.
 *
 * @see lib/wagmiConfig.ts - imports these chains for the wallet adapter
 * @see lib/viemClient.ts - imports these chains for server-side RPC clients
 */

import { defineChain, type Chain } from 'viem';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from './network-mode';

// --- RPC Configuration ---
// NEXT_PUBLIC_RPC_URL is the primary RPC (e.g., DRPC, Alchemy), public RPCs as fallback
const primaryRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

const publicMainnetRpcs = [
  'https://mainnet.base.org',
  'https://base.drpc.org',
  'https://base.publicnode.com',
  'https://1rpc.io/base'
];

const publicTestnetRpcs = [
  'https://sepolia.base.org',
  'https://base-sepolia.drpc.org',
  'https://base-sepolia.publicnode.com',
  'https://1rpc.io/base-sepolia'
];

// Primary RPC first, public fallbacks after
const mainnetRpcUrls = primaryRpcUrl ? [primaryRpcUrl, ...publicMainnetRpcs] : publicMainnetRpcs;
const testnetRpcUrls = publicTestnetRpcs;

export const baseSepolia = defineChain({
  id: TESTNET_CHAIN_ID,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: testnetRpcUrls },
    public: { http: testnetRpcUrls },
  },
  blockExplorers: {
    default: { name: 'Basescan Sepolia', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

export const baseMainnet = defineChain({
  id: MAINNET_CHAIN_ID,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: mainnetRpcUrls },
    public: { http: mainnetRpcUrls },
  },
  blockExplorers: {
    default: { name: 'Basescan', url: 'https://basescan.org' },
  },
  testnet: false,
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

/**
 * Get ordered RPC URLs for a chain
 */
export function getOrderedRpcUrls(chain: Chain): string[] {
  if (chain.id === MAINNET_CHAIN_ID) {
    return mainnetRpcUrls;
  }
  if (chain.id === TESTNET_CHAIN_ID) {
    return testnetRpcUrls;
  }
  // For other chains (like Ethereum mainnet for ENS), use default RPC
  return chain.rpcUrls.default.http as string[];
}
