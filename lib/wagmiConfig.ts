import { http, createStorage, cookieStorage, fallback } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet } from 'wagmi/chains'
import { createClient } from 'viem'
import { getStoredNetworkMode, type NetworkMode } from './network-mode'
import { CHAIN_REGISTRY } from './chain-registry'
import { baseMainnet, arbitrumOne, getOrderedRpcUrls, getChainForMode } from './chains'

export { baseMainnet, arbitrumOne }

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID

if (!projectId) {
  console.error('NEXT_PUBLIC_PROJECT_ID is not set.')
}

export function getActiveChain(mode?: NetworkMode) {
  return getChainForMode(mode ?? getStoredNetworkMode());
}

// All chains available for wallet switching (Ethereum mainnet included for ENS)
export const networks = [baseMainnet, arbitrumOne, mainnet];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: projectId || '',
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  client({ chain }) {
    const urls = getOrderedRpcUrls(chain);
    return createClient({
      chain,
      batch: { multicall: true },
      pollingInterval: 12_000,
      transport: fallback(
        urls.map((url) => http(url, { timeout: 10_000 }))
      ),
    });
  },
})

export const config = wagmiAdapter.wagmiConfig

/** @deprecated Use chainIdForMode(mode) or getActiveChain(mode) instead */
export const activeChain = getActiveChain();
/** @deprecated Use chainIdForMode(mode) instead */
export const activeChainId = activeChain.id;
/** @deprecated Derive from data's networkMode instead */
export const isBase = getStoredNetworkMode() === 'base';

export function getExplorerUrl(mode?: NetworkMode): string {
  if (mode) return CHAIN_REGISTRY[mode].explorerUrl;
  const chain = getActiveChain();
  return chain.blockExplorers?.default?.url || 'https://basescan.org';
}

export function getExplorerTxUrl(txHash: string, mode?: NetworkMode): string {
  return `${getExplorerUrl(mode)}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string, mode?: NetworkMode): string {
  return `${getExplorerUrl(mode)}/address/${address}`;
} 