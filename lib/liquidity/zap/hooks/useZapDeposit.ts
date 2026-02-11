/**
 * useZapDeposit Hook
 *
 * Main orchestration hook for executing a zap deposit.
 * Provides preview calculation and execution control.
 *
 * Note: Actual step execution is handled by the step executor in ReviewExecuteModal.
 */

'use client';

import { useState, useCallback } from 'react';
import { type Address, parseUnits } from 'viem';
import { usePublicClient } from 'wagmi';

import { useZapPreview, isPreviewFresh } from './useZapPreview';
import type {
  ZapToken,
  ZapPreviewResult,
  UseZapDepositParams,
  UseZapDepositReturn,
} from '../types';

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to orchestrate a zap deposit operation.
 *
 * @param params - Deposit parameters (poolId, hookAddress, token addresses)
 * @returns Preview and execution controls
 */
export function useZapDeposit(params: UseZapDepositParams): UseZapDepositReturn {
  const { hookAddress } = params;
  const publicClient = usePublicClient();

  // Local state
  const [preview, setPreview] = useState<ZapPreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  /**
   * Get a preview for a zap deposit
   */
  const getPreview = useCallback(
    async (inputToken: ZapToken, inputAmount: string): Promise<ZapPreviewResult | null> => {
      if (!publicClient || !hookAddress || !inputAmount || parseFloat(inputAmount) <= 0) {
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // We use the useZapPreview hook internally for the actual calculation
        // But for the imperative API, we'll simulate it here
        // In practice, the caller should use useZapPreview directly for reactive data
        setIsLoading(false);
        return null; // Caller should use useZapPreview hook for reactive preview
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to get preview'));
        setIsLoading(false);
        return null;
      }
    },
    [publicClient, hookAddress]
  );

  /**
   * Execute a zap deposit
   * Note: This is a placeholder - actual execution is handled by ReviewExecuteModal
   */
  const executeZap = useCallback(
    async (zapPreview: ZapPreviewResult): Promise<void> => {
      if (!isPreviewFresh(zapPreview)) {
        throw new Error('Preview is stale, please refresh');
      }

      setPreview(zapPreview);
      // Actual execution is handled by ReviewExecuteModal using the step executor
      // This hook just manages the state
    },
    []
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setPreview(null);
    setIsLoading(false);
    setError(null);
    setTxHash(null);
  }, []);

  return {
    getPreview,
    executeZap,
    preview,
    isLoading,
    error,
    txHash,
    reset,
  };
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Calculate the estimated gas cost for a zap deposit.
 *
 * @param stepCount - Number of transaction steps
 * @returns Estimated gas units
 */
export function estimateZapGas(stepCount: number): bigint {
  // Rough estimates per step type
  const gasPerApproval = 50_000n;
  const gasPerSwap = 150_000n;
  const gasPerDeposit = 250_000n;

  // Conservative estimate: assume 2 approvals, 1 swap, 1 deposit
  return gasPerApproval * 2n + gasPerSwap + gasPerDeposit;
}

/**
 * Format a zap preview for display.
 *
 * @param preview - Preview result
 * @param inputToken - Input token type
 * @returns Formatted strings for UI
 */
export function formatZapPreviewForDisplay(
  preview: ZapPreviewResult,
  inputToken: ZapToken
): {
  swapDescription: string;
  depositDescription: string;
  leftoverWarning: string | null;
} {
  const outputToken: ZapToken = inputToken === 'USDS' ? 'USDC' : 'USDS';
  const routeLabel = preview.route.type === 'psm' ? 'PSM (1:1)' : 'Pool swap';

  const swapDescription = `Swap ${preview.formatted.swapAmount} ${inputToken} for ~${preview.formatted.swapOutputAmount} ${outputToken} via ${routeLabel}`;

  const depositDescription = `Deposit into Unified Yield pool for ${preview.formatted.expectedShares} shares`;

  // Only show leftover warning if significant
  let leftoverWarning: string | null = null;
  if (preview.leftoverPercent > 0.5) {
    const token0Leftover = parseFloat(preview.formatted.leftoverToken0);
    const token1Leftover = parseFloat(preview.formatted.leftoverToken1);

    if (token0Leftover > 0.01 || token1Leftover > 0.01) {
      leftoverWarning = `Expected leftover: ${token0Leftover.toFixed(4)} USDS, ${token1Leftover.toFixed(4)} USDC (${preview.leftoverPercent.toFixed(2)}%)`;
    }
  }

  return {
    swapDescription,
    depositDescription,
    leftoverWarning,
  };
}
