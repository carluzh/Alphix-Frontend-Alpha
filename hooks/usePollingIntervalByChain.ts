/**
 * Chain-based polling interval hook
 *
 * Returns appropriate polling interval based on chain type (L1 vs L2).
 * Base is an L2, so we use faster polling intervals.
 *
 * @see interface/packages/uniswap/src/features/transactions/hooks/usePollingIntervalByChain.ts
 */

import { useNetwork } from '@/lib/network-context'

const ONE_SECOND_MS = 1000

export const AVERAGE_L1_BLOCK_TIME_MS = 12 * ONE_SECOND_MS
export const AVERAGE_L2_BLOCK_TIME_MS = 3 * ONE_SECOND_MS

/**
 * Returns the appropriate polling interval based on the current chain.
 * Base (mainnet and Sepolia) are L2 chains, so we use faster polling.
 *
 * @returns Polling interval in milliseconds
 *
 * @example
 * const pollingInterval = usePollingIntervalByChain()
 * // Returns 3000ms for Base (L2)
 */
export function usePollingIntervalByChain(): number {
  const { networkMode } = useNetwork()

  // Both Base mainnet and Base Sepolia are L2 chains
  // L2 chains have faster block times (~2-3 seconds)
  const isL2 = networkMode === 'mainnet' || networkMode === 'testnet'

  return isL2 ? AVERAGE_L2_BLOCK_TIME_MS : AVERAGE_L1_BLOCK_TIME_MS
}

/**
 * Non-hook version for use outside React components
 * Assumes L2 since we're only on Base
 */
export function getPollingIntervalByChain(isL2: boolean = true): number {
  return isL2 ? AVERAGE_L2_BLOCK_TIME_MS : AVERAGE_L1_BLOCK_TIME_MS
}
