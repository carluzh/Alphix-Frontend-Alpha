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
const customRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

const testnetRpcUrls = [
  'https://sepolia.base.org',
  'https://base-sepolia.drpc.org',
  'https://base-sepolia.publicnode.com',
  'https://1rpc.io/base-sepolia'
];

const mainnetRpcUrls = [
  'https://mainnet.base.org',
  'https://base.drpc.org',
  'https://base.publicnode.com',
  'https://1rpc.io/base'
];

// For E2E testing with Anvil fork using chain ID 1337
const isE2EMode = customRpcUrl?.includes('127.0.0.1') || customRpcUrl?.includes('localhost');

// Detect if custom RPC URL is for testnet or mainnet
const isCustomUrlTestnet = customRpcUrl?.includes('sepolia') || customRpcUrl?.includes('testnet');
const isCustomUrlMainnet = customRpcUrl?.includes('mainnet') ||
                           customRpcUrl?.includes('base.g.alchemy') ||
                           customRpcUrl?.includes('base-mainnet');

// Alchemy first, public RPCs as fallback
const testnetRpcUrlsFinal = isE2EMode
  ? [customRpcUrl!]
  : (isCustomUrlTestnet ? [customRpcUrl!, ...testnetRpcUrls] : testnetRpcUrls);
const mainnetRpcUrlsFinal = isCustomUrlMainnet
  ? [customRpcUrl!, ...mainnetRpcUrls]
  : mainnetRpcUrls;

export const baseSepolia = defineChain({
  id: isE2EMode ? 1337 : TESTNET_CHAIN_ID,
  name: isE2EMode ? 'Base Sepolia (local)' : 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: testnetRpcUrlsFinal
    },
    public: {
      http: testnetRpcUrlsFinal
    },
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
    default: {
      http: mainnetRpcUrlsFinal
    },
    public: {
      http: mainnetRpcUrlsFinal
    },
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
 * Get ordered RPC URLs for a chain (custom URL first if matching, then public fallbacks)
 */
export function getOrderedRpcUrls(chain: Chain): string[] {
  if (chain.id === MAINNET_CHAIN_ID) {
    return mainnetRpcUrlsFinal;
  }
  if (chain.id === TESTNET_CHAIN_ID || chain.id === 1337) {
    return testnetRpcUrlsFinal;
  }
  // For other chains (like Ethereum mainnet for ENS), use default RPC
  return chain.rpcUrls.default.http as string[];
}
