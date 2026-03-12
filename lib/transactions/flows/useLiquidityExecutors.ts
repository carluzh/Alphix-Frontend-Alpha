/**
 * Liquidity Executors — All Domains Combined
 *
 * Composes swap-domain and liquidity-domain executors into a single
 * Record<string, StepExecutorFn>. Backward-compatible wrapper used by
 * components that need full coverage (e.g., zap flows that compose
 * swap steps + liquidity deposit steps).
 *
 * For domain-specific usage:
 * - Swap-only flows: useSwapDomainExecutors
 * - Liquidity-only flows: useLiquidityDomainExecutors
 * - Zap / mixed flows: useLiquidityExecutors (this file)
 *
 * @see useExecutorBridge.ts — shared factory
 * @see useSwapDomainExecutors.ts — swap domain
 * @see useLiquidityDomainExecutors.ts — liquidity domain
 */

import type { RefObject } from 'react';
import type { ValidatedLiquidityTxContext } from '@/lib/liquidity/types';
import { useExecutorBridge, ALL_DOMAIN_STEPS } from './useExecutorBridge';

/**
 * Returns executors for ALL step types (swap + liquidity domains).
 *
 * @param txContextRef - Ref to the current ValidatedLiquidityTxContext.
 *   The caller must set `txContextRef.current` before calling execute().
 */
export function useLiquidityExecutors(
  txContextRef: RefObject<ValidatedLiquidityTxContext | null>,
) {
  return useExecutorBridge(txContextRef, ALL_DOMAIN_STEPS);
}
