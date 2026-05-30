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

// Primary RPC first, public fallbacks after.
// In E2E (NEXT_PUBLIC_E2E), the primary URL is a local Anvil fork — drop the
// public fallbacks so reads/sends hit ONLY the fork (no silent fallthrough to
// public mainnet, which would break fork-state determinism). This also fixes
// the address the wagmi `mock` connector signs against: it uses
// rpcUrls.default.http[0], i.e. these arrays' first entry.
const E2E = process.env.NEXT_PUBLIC_E2E === 'true';
const baseMainnetRpcUrls = E2E && primaryBaseRpcUrl
  ? [primaryBaseRpcUrl]
  : (primaryBaseRpcUrl ? [primaryBaseRpcUrl, ...publicBaseMainnetRpcs] : publicBaseMainnetRpcs);
const arbitrumRpcUrls = E2E && primaryArbitrumRpcUrl
  ? [primaryArbitrumRpcUrl]
  : (primaryArbitrumRpcUrl ? [primaryArbitrumRpcUrl, ...publicArbitrumRpcs] : publicArbitrumRpcs);

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
