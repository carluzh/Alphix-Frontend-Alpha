/**
 * Swap Domain Executors
 *
 * Covers step types that perform token swaps:
 * - Token approval (to swap router / Permit2)
 * - Permit2 signature
 * - Zap swap approval, PSM swap, pool swap
 *
 * Used by: zap flows (swap portion).
 * Note: Main swap flow uses useSwapFlow which has its own executors
 * for the Alphix/Kyberswap-specific swap transaction.
 *
 * @see useExecutorBridge.ts — shared factory
 * @see useSwapFlow.ts — main swap flow (separate executors)
 */

import type { RefObject } from 'react';
import type { ValidatedLiquidityTxContext } from '@/lib/liquidity/types';
import { useExecutorBridge, SWAP_DOMAIN_STEPS } from './useExecutorBridge';

export function useSwapDomainExecutors(
  txContextRef: RefObject<ValidatedLiquidityTxContext | null>,
) {
  return useExecutorBridge(txContextRef, SWAP_DOMAIN_STEPS);
}
