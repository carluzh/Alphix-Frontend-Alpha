// Centralized chain configuration registry.
// Adding a new chain = adding one entry to CHAIN_REGISTRY.
// No other files should contain per-chain switch/ternary logic.

import type { NetworkMode } from './network-mode';

export interface ChainConfig {
  networkMode: NetworkMode;
  chainId: number;
  displayName: string;       // "Base", "Arbitrum"
  backendNetwork: string;    // "base", "arbitrum" — for backend ?network= param
  apolloChain: string;       // "BASE", "ARBITRUM" — for GraphQL chain enum
  explorerUrl: string;
  quoteToken: string;        // Symbol of the USD stablecoin used for pricing
  isL2: boolean;
  protocols: ('aave' | 'spark')[];
}

export const CHAIN_REGISTRY: Record<NetworkMode, ChainConfig> = {
  base: {
    networkMode: 'base',
    chainId: 8453,
    displayName: 'Base',
    backendNetwork: 'base',
    apolloChain: 'BASE',
    explorerUrl: 'https://basescan.org',
    quoteToken: 'USDC',
    isL2: true,
    protocols: ['aave', 'spark'],
  },
  arbitrum: {
    networkMode: 'arbitrum',
    chainId: 42161,
    displayName: 'Arbitrum',
    backendNetwork: 'arbitrum',
    apolloChain: 'ARBITRUM',
    explorerUrl: 'https://arbiscan.io',
    quoteToken: 'USDC',
    isL2: true,
    protocols: ['aave'],
  },
};

/** All supported NetworkMode values, derived from the registry */
export const ALL_MODES: NetworkMode[] = Object.keys(CHAIN_REGISTRY) as NetworkMode[];

/** All supported chain IDs, derived from the registry */
export const ALL_CHAIN_IDS: number[] = ALL_MODES.map(m => CHAIN_REGISTRY[m].chainId);

/** Lookup chain config by chainId */
export function getChainConfigByChainId(chainId: number): ChainConfig | undefined {
  return ALL_MODES.map(m => CHAIN_REGISTRY[m]).find(c => c.chainId === chainId);
}
