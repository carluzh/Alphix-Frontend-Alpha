/**
 * useZapPreview Hook
 *
 * Calculates and returns a preview of a zap deposit operation.
 * This hook fetches pool state, calculates optimal swap amount,
 * selects the best route (PSM vs Pool), and estimates the result.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { type Address, formatUnits, parseUnits } from 'viem';
import { usePublicClient } from 'wagmi';

import {
  calculateOptimalSwapAmount,
  calculatePoolRatio,
  calculatePoolRatioFromToken1,
  calculatePostSwapAmounts,
  estimateLeftover,
  calculateLeftoverPercent,
} from '../calculation';
import { selectSwapRoute, getPSMQuote } from '../routing';
import { USDS_USDC_POOL_CONFIG, MAX_PREVIEW_AGE_MS } from '../constants';
import type { ZapToken, ZapPreviewResult, UseZapPreviewParams } from '../types';
import { ZapError, ZapErrorCode } from '../types';

// Import Unified Yield preview functions
import {
  previewAddFromAmount0,
  previewAddFromAmount1,
} from '../../unified-yield/buildUnifiedYieldDepositTx';

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to get a preview of a zap deposit.
 *
 * @param params - Preview parameters
 * @returns Query result with preview data
 */
export function useZapPreview(params: UseZapPreviewParams) {
  const { inputToken, inputAmount, hookAddress, enabled = true } = params;
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
      const inputDecimals = inputToken === 'USDS' ? 18 : 6;
      const inputAmountWei = parseUnits(inputAmount, inputDecimals);

      // Step 1: Get pool ratio from Hook preview
      // We use a small amount to get the ratio without affecting the result
      const testAmount = inputToken === 'USDS' ? 10n ** 18n : 10n ** 6n; // 1 unit

      let poolRatio: number;
      if (inputToken === 'USDS') {
        const preview = await previewAddFromAmount0(hookAddress, testAmount, publicClient);
        if (!preview) {
          throw new ZapError(ZapErrorCode.POOL_LIQUIDITY_LOW, 'Failed to get pool ratio');
        }
        poolRatio = calculatePoolRatio(testAmount, preview.otherAmount, 18, 6);
      } else {
        const preview = await previewAddFromAmount1(hookAddress, testAmount, publicClient);
        if (!preview) {
          throw new ZapError(ZapErrorCode.POOL_LIQUIDITY_LOW, 'Failed to get pool ratio');
        }
        poolRatio = calculatePoolRatioFromToken1(testAmount, preview.otherAmount, 18, 6);
      }

      // Step 2: Calculate optimal swap amount
      const inputPosition = inputToken === 'USDS' ? 'token0' : 'token1';
      const swapAmount = calculateOptimalSwapAmount(
        inputPosition,
        inputAmountWei,
        poolRatio,
        1.0 // Assume PSM rate initially
      );

      // Step 3: Select route (PSM vs Pool)
      const routeResult = await selectSwapRoute({
        inputToken,
        swapAmount,
        publicClient,
      });

      // Step 4: Calculate post-swap amounts
      const postSwapAmounts = calculatePostSwapAmounts(
        inputToken,
        inputAmountWei,
        swapAmount,
        routeResult.outputAmount
      );

      // Step 5: Get deposit preview from Hook
      let depositPreview: { otherAmount: bigint; shares: bigint } | null;
      let estimatedToken0Used: bigint;
      let estimatedToken1Used: bigint;

      // We have both tokens now, preview from the larger side
      if (inputToken === 'USDS') {
        depositPreview = await previewAddFromAmount0(
          hookAddress,
          postSwapAmounts.token0Amount,
          publicClient
        );
        if (!depositPreview) {
          throw new ZapError(ZapErrorCode.POOL_LIQUIDITY_LOW, 'Failed to preview deposit');
        }
        estimatedToken0Used = postSwapAmounts.token0Amount;
        // Use the minimum of what we have and what's required
        estimatedToken1Used =
          depositPreview.otherAmount < postSwapAmounts.token1Amount
            ? depositPreview.otherAmount
            : postSwapAmounts.token1Amount;
      } else {
        depositPreview = await previewAddFromAmount1(
          hookAddress,
          postSwapAmounts.token1Amount,
          publicClient
        );
        if (!depositPreview) {
          throw new ZapError(ZapErrorCode.POOL_LIQUIDITY_LOW, 'Failed to preview deposit');
        }
        estimatedToken1Used = postSwapAmounts.token1Amount;
        estimatedToken0Used =
          depositPreview.otherAmount < postSwapAmounts.token0Amount
            ? depositPreview.otherAmount
            : postSwapAmounts.token0Amount;
      }

      // Step 6: Estimate leftover
      const leftover = estimateLeftover(
        postSwapAmounts.token0Amount,
        postSwapAmounts.token1Amount,
        estimatedToken0Used,
        estimatedToken1Used
      );

      const leftoverPercent = calculateLeftoverPercent(
        leftover.leftover0,
        leftover.leftover1,
        inputAmountWei,
        inputToken
      );

      // Build result
      const outputToken: ZapToken = inputToken === 'USDS' ? 'USDC' : 'USDS';
      const outputDecimals = outputToken === 'USDS' ? 18 : 6;

      const result: ZapPreviewResult = {
        swapAmount,
        swapOutputAmount: routeResult.outputAmount,
        remainingInputAmount: inputAmountWei - swapAmount,
        route: routeResult.route,
        expectedShares: depositPreview.shares,
        estimatedLeftover: {
          token0: leftover.leftover0,
          token1: leftover.leftover1,
        },
        leftoverPercent,
        formatted: {
          inputAmount,
          swapAmount: formatUnits(swapAmount, inputDecimals),
          swapOutputAmount: formatUnits(routeResult.outputAmount, outputDecimals),
          remainingInputAmount: formatUnits(inputAmountWei - swapAmount, inputDecimals),
          expectedShares: formatUnits(depositPreview.shares, 18),
          leftoverToken0: formatUnits(leftover.leftover0, 18),
          leftoverToken1: formatUnits(leftover.leftover1, 6),
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
        timestamp: Date.now(),
      };

      return result;
    },
    enabled: enabled && !!inputToken && !!inputAmount && parseFloat(inputAmount || '0') > 0 && !!hookAddress && !!publicClient,
    staleTime: MAX_PREVIEW_AGE_MS,
    gcTime: MAX_PREVIEW_AGE_MS * 2,
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
