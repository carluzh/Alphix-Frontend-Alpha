/**
 * useZapPreview Hook
 *
 * Calculates and returns a preview of a zap deposit operation.
 * Uses binary search with Hook preview functions to find optimal swap amount.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { type Address, formatUnits, parseUnits } from 'viem';
import { usePublicClient } from 'wagmi';

import { findOptimalSwapAmount } from '../calculation';
import { USDS_USDC_POOL_CONFIG, MAX_PREVIEW_AGE_MS } from '../constants';
import type { ZapToken, ZapPreviewResult, UseZapPreviewParams } from '../types';
import { ZapError, ZapErrorCode } from '../types';
import { UNIFIED_YIELD_HOOK_ABI } from '../../unified-yield/abi/unifiedYieldHookABI';

// =============================================================================
// CONSTANTS
// =============================================================================

/** USDS decimals */
const USDS_DECIMALS = 18;

/** USDC decimals */
const USDC_DECIMALS = 6;

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to get a preview of a zap deposit.
 *
 * Uses binary search to find the optimal swap amount that minimizes leftover (dust).
 * Target: < 0.01% of input value as dust.
 *
 * @param params - Preview parameters
 * @returns Query result with preview data
 */
export function useZapPreview(params: UseZapPreviewParams) {
  const { inputToken, inputAmount, hookAddress, enabled = true, refetchEnabled = true } = params;
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['zap-preview', inputToken, inputAmount, hookAddress],
    queryFn: async (): Promise<ZapPreviewResult> => {
      if (!inputToken || !inputAmount || !hookAddress || !publicClient) {
        throw new ZapError(ZapErrorCode.INVALID_INPUT, 'Missing required parameters');
      }

      const parsedAmount = parseFloat(inputAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new ZapError(ZapErrorCode.INVALID_INPUT, 'Invalid input amount');
      }

      // Parse input amount to wei
      const inputDecimals = inputToken === 'USDS' ? USDS_DECIMALS : USDC_DECIMALS;
      const inputAmountWei = parseUnits(inputAmount, inputDecimals);

      // Use binary search to find optimal swap amount
      const optimalResult = await findOptimalSwapAmount({
        inputToken,
        inputAmount: inputAmountWei,
        hookAddress,
        publicClient,
      });

      // Calculate leftover amounts
      // After swap: we have remainingInput of inputToken and swapOutput of outputToken
      // For deposit: we need requiredOther of outputToken
      // Leftover = swapOutput - requiredOther (in output token)
      const outputToken: ZapToken = inputToken === 'USDS' ? 'USDC' : 'USDS';
      const outputDecimals = outputToken === 'USDS' ? USDS_DECIMALS : USDC_DECIMALS;

      // Dust is the difference between swap output and what Hook needs
      const dustInOutputToken =
        optimalResult.swapOutput > optimalResult.requiredOther
          ? optimalResult.swapOutput - optimalResult.requiredOther
          : 0n;

      // Map dust to token0/token1 based on output token
      const leftover0 = outputToken === 'USDS' ? dustInOutputToken : 0n;
      const leftover1 = outputToken === 'USDC' ? dustInOutputToken : 0n;

      // Get on-chain share valuation
      let shareValue: ZapPreviewResult['shareValue'] | undefined;
      try {
        console.log('[useZapPreview] Fetching share valuation for shares:', optimalResult.expectedShares.toString());

        const [shareAmount0, shareAmount1] = await publicClient.readContract({
          address: hookAddress,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'previewRemoveReHypothecatedLiquidity',
          args: [optimalResult.expectedShares],
        }) as [bigint, bigint];

        const formatted0 = formatUnits(shareAmount0, USDS_DECIMALS);
        const formatted1 = formatUnits(shareAmount1, USDC_DECIMALS);

        console.log('[useZapPreview] Share valuation result:', {
          expectedShares: formatUnits(optimalResult.expectedShares, 18),
          shareAmount0: formatted0,
          shareAmount1: formatted1,
          totalUSD: parseFloat(formatted0) + parseFloat(formatted1),
          inputAmount,
        });

        shareValue = {
          amount0: shareAmount0,
          amount1: shareAmount1,
          formatted0,
          formatted1,
        };
      } catch (e) {
        // Non-critical - continue without share valuation
        console.warn('[useZapPreview] Failed to get share valuation:', e);
      }

      // Build preview result
      const result: ZapPreviewResult = {
        swapAmount: optimalResult.swapAmount,
        swapOutputAmount: optimalResult.swapOutput,
        remainingInputAmount: optimalResult.remainingInput,
        route: optimalResult.route,
        expectedShares: optimalResult.expectedShares,
        estimatedLeftover: {
          token0: leftover0,
          token1: leftover1,
        },
        leftoverPercent: optimalResult.estimatedDustPercent,
        formatted: {
          inputAmount,
          swapAmount: formatUnits(optimalResult.swapAmount, inputDecimals),
          swapOutputAmount: formatUnits(optimalResult.swapOutput, outputDecimals),
          remainingInputAmount: formatUnits(optimalResult.remainingInput, inputDecimals),
          expectedShares: formatUnits(optimalResult.expectedShares, 18),
          leftoverToken0: formatUnits(leftover0, USDS_DECIMALS),
          leftoverToken1: formatUnits(leftover1, USDC_DECIMALS),
        },
        inputTokenInfo: {
          symbol: inputToken,
          decimals: inputDecimals,
          address:
            inputToken === 'USDS'
              ? USDS_USDC_POOL_CONFIG.token0.address
              : USDS_USDC_POOL_CONFIG.token1.address,
        },
        outputTokenInfo: {
          symbol: outputToken,
          decimals: outputDecimals,
          address:
            outputToken === 'USDS'
              ? USDS_USDC_POOL_CONFIG.token0.address
              : USDS_USDC_POOL_CONFIG.token1.address,
        },
        shareValue,
        timestamp: Date.now(),
      };

      return result;
    },
    enabled: enabled && !!inputToken && !!inputAmount && parseFloat(inputAmount || '0') > 0 && !!hookAddress && !!publicClient,
    staleTime: 10_000, // 10 seconds - consider data stale quickly for fresh quotes
    gcTime: MAX_PREVIEW_AGE_MS * 2,
    refetchOnMount: 'always', // Always refetch when component mounts (e.g., modal reopens)
    refetchInterval: refetchEnabled ? 10_000 : false, // Auto-refetch every 10 seconds, disabled during execution
    retry: 1,
  });
}

/**
 * Check if a preview is still fresh.
 *
 * @param preview - Preview result
 * @returns Whether the preview is still valid
 */
export function isPreviewFresh(preview: ZapPreviewResult | null | undefined): boolean {
  if (!preview) return false;
  return Date.now() - preview.timestamp < MAX_PREVIEW_AGE_MS;
}
