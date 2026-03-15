/**
 * Chain-based polling interval hook
 *
 * Returns appropriate polling interval based on chain type (L1 vs L2).
 * Base is an L2, so we use faster polling intervals.
 *
 * @see interface/packages/uniswap/src/features/transactions/hooks/usePollingIntervalByChain.ts
 */

import { CHAIN_REGISTRY } from '@/lib/chain-registry'
import type { NetworkMode } from '@/lib/network-mode'

const ONE_SECOND_MS = 1000

// Polling intervals (conservative, slightly longer than actual block times)
// These are for API/RPC polling cadence, NOT for deadline calculations
// For actual block times, use lib/swap-constants.ts: AVERAGE_L1_BLOCK_TIME_MS (12s), AVERAGE_L2_BLOCK_TIME_MS (2s)
export const POLLING_INTERVAL_L1_MS = 12 * ONE_SECOND_MS
export const POLLING_INTERVAL_L2_MS = 3 * ONE_SECOND_MS

/**
 * Returns the appropriate polling interval for a given network mode.
 * All supported chains (Base, Arbitrum) are L2 — returns L2 interval.
 */
export function usePollingIntervalByChain(networkMode?: NetworkMode): number {
  const isL2 = networkMode ? CHAIN_REGISTRY[networkMode].isL2 : true
  return isL2 ? POLLING_INTERVAL_L2_MS : POLLING_INTERVAL_L1_MS
}
