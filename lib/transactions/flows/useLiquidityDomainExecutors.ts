/**
 * Liquidity Domain Executors
 *
 * Covers step types that touch positions:
 * - Token approval/revocation (to Permit2 / Hook)
 * - Permit2 signature + transaction
 * - Create/Increase/Decrease position (+async)
 * - Collect fees
 * - Unified Yield approval, deposit, withdraw
 * - Zap dynamic deposit (deposit portion of zap)
 *
 * Used by: all liquidity flows (create, increase, decrease, collect, UY).
 *
 * @see useExecutorBridge.ts — shared factory
 */

import type { RefObject } from 'react';
import type { ValidatedLiquidityTxContext } from '@/lib/liquidity/types';
import { useExecutorBridge, LIQUIDITY_DOMAIN_STEPS } from './useExecutorBridge';

export function useLiquidityDomainExecutors(
  txContextRef: RefObject<ValidatedLiquidityTxContext | null>,
) {
  return useExecutorBridge(txContextRef, LIQUIDITY_DOMAIN_STEPS);
}
