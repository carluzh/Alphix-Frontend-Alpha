import { http, createStorage, cookieStorage, fallback, createConfig } from 'wagmi'
import { mock } from 'wagmi/connectors'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet } from 'wagmi/chains'
import { createClient } from 'viem'
import { getStoredNetworkMode, type NetworkMode } from './network-mode'
import { CHAIN_REGISTRY } from './chain-registry'
import { baseMainnet, arbitrumOne, getOrderedRpcUrls, getChainForMode } from './chains'

// --- E2E (Playwright) test wallet — gated, inert in normal builds ----------
// When NEXT_PUBLIC_E2E === 'true' we append wagmi's `mock` connector so the app
// can be wallet-connected headlessly without driving the Reown modal. The mock
// holds NO private key — it forwards eth_sendTransaction / eth_signTypedData_v4
// to the connected chain's rpcUrls.default.http[0] (which the E2E build points
// at a local Anvil fork), and the fork's unlocked account signs + submits.
// The account is read from window.__E2E_ACCOUNT__ (injected per-test before page
// load); falls back to Anvil's default account #0. See /e2e for the harness.
const E2E_ENABLED = process.env.NEXT_PUBLIC_E2E === 'true'
const ANVIL_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
function resolveE2EAccount(): `0x${string}` {
  if (typeof window !== 'undefined') {
    const injected = (window as unknown as { __E2E_ACCOUNT__?: string }).__E2E_ACCOUNT__
    if (typeof injected === 'string' && /^0x[0-9a-fA-F]{40}$/.test(injected)) {
      return injected as `0x${string}`
    }
  }
  return ANVIL_ACCOUNT_0
}
const e2eConnectors = E2E_ENABLED
  ? [mock({ accounts: [resolveE2EAccount()], features: { reconnect: true } })]
  : undefined

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
  // E2E-only mock connector (undefined in normal builds). Reown's WagmiAdapter
  // spreads `connectors` into the underlying wagmi createConfig; AppKit's own
  // connectors are appended additively, so this coexists with them.
  connectors: e2eConnectors,
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

/**
 * E2E config: a PLAIN wagmi config (no Reown adapter) whose per-chain transports
 * point at the local Anvil forks. Reown's WagmiAdapter rewrites each chain's RPC
 * to its read-only WalletConnect relay (rpc.walletconnect.org), which the mock
 * connector then uses for eth_sendTransaction — and that relay rejects sends
 * ("method not available"). Bypassing the adapter in E2E keeps reads AND the
 * mock's sends/sign on the fork. Gated on NEXT_PUBLIC_E2E; inert in prod.
 */
function buildE2EWagmiConfig() {
  return createConfig({
    chains: [baseMainnet, arbitrumOne, mainnet],
    connectors: e2eConnectors,
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
    transports: {
      [baseMainnet.id]: fallback(getOrderedRpcUrls(baseMainnet).map((u) => http(u, { timeout: 30_000 }))),
      [arbitrumOne.id]: fallback(getOrderedRpcUrls(arbitrumOne).map((u) => http(u, { timeout: 30_000 }))),
      [mainnet.id]: http(),
    },
  })
}

export const config = E2E_ENABLED ? buildE2EWagmiConfig() : wagmiAdapter.wagmiConfig

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