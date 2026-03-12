// Chain definitions for viem/wagmi — no wallet adapter imports (safe for server-side)

import { defineChain, type Chain } from 'viem';
import {
  BASE_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  type NetworkMode,
} from './network-mode';

const primaryBaseRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
const primaryArbitrumRpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL;

const publicBaseMainnetRpcs = [
  'https://mainnet.base.org',
  'https://base.drpc.org',
  'https://base.publicnode.com',
  'https://1rpc.io/base',
];

const publicArbitrumRpcs = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum.drpc.org',
  'https://arbitrum-one.publicnode.com',
  'https://1rpc.io/arb',
];

// Primary RPC first, public fallbacks after
const baseMainnetRpcUrls = primaryBaseRpcUrl ? [primaryBaseRpcUrl, ...publicBaseMainnetRpcs] : publicBaseMainnetRpcs;
const arbitrumRpcUrls = primaryArbitrumRpcUrl ? [primaryArbitrumRpcUrl, ...publicArbitrumRpcs] : publicArbitrumRpcs;

export const baseMainnet = defineChain({
  id: BASE_CHAIN_ID,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: baseMainnetRpcUrls },
    public: { http: baseMainnetRpcUrls },
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

export const arbitrumOne = defineChain({
  id: ARBITRUM_CHAIN_ID,
  name: 'Arbitrum One',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: arbitrumRpcUrls },
    public: { http: arbitrumRpcUrls },
  },
  blockExplorers: {
    default: { name: 'Arbiscan', url: 'https://arbiscan.io' },
  },
  testnet: false,
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

/** Get the chain definition for a NetworkMode */
export function getChainForMode(mode: NetworkMode): Chain {
  switch (mode) {
    case 'base': return baseMainnet;
    case 'arbitrum': return arbitrumOne;
  }
}

/**
 * Get ordered RPC URLs for a chain
 */
export function getOrderedRpcUrls(chain: Chain): string[] {
  if (chain.id === BASE_CHAIN_ID) {
    return baseMainnetRpcUrls;
  }
  if (chain.id === ARBITRUM_CHAIN_ID) {
    return arbitrumRpcUrls;
  }
  // For other chains (like Ethereum mainnet for ENS), use default RPC
  return chain.rpcUrls.default.http as string[];
}
