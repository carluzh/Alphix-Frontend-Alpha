/**
 * useZapPreview Hook
 *
 * Returns a single-quote preview for a zap deposit into the USDC/USDT
 * Unified Yield pool. No iterative search — the dynamic deposit handler
 * reconciles dust at execution time.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { formatUnits, parseUnits } from 'viem';
import { usePublicClient } from 'wagmi';
import { chainIdForMode } from '@/lib/network-mode';

import { getZapPreview } from '../preview';
import { MAX_PREVIEW_AGE_MS, getZapPoolConfigByHook } from '../constants';
import type { ZapToken, ZapPreviewResult, UseZapPreviewParams } from '../types';
import { ZapError, ZapErrorCode } from '../types';
import { UNIFIED_YIELD_HOOK_ABI } from '../../unified-yield/abi/unifiedYieldHookABI';

export function useZapPreview(params: UseZapPreviewParams) {
  const { inputToken, inputAmount, hookAddress, enabled = true, refetchEnabled = true, networkMode } = params;
  const targetChainId = networkMode ? chainIdForMode(networkMode) : undefined;
  const publicClient = usePublicClient({ chainId: targetChainId });

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

      const poolConfig = getZapPoolConfigByHook(hookAddress);
      if (!poolConfig) {
        throw new ZapError(ZapErrorCode.INVALID_INPUT, `No zap pool config found for hook ${hookAddress}`);
      }

      const isInputToken0 = inputToken === poolConfig.token0.symbol;
      const inputDecimals = isInputToken0 ? poolConfig.token0.decimals : poolConfig.token1.decimals;
      const inputAmountWei = parseUnits(inputAmount, inputDecimals);

      const preview = await getZapPreview({
        inputToken,
        inputAmount: inputAmountWei,
        hookAddress,
        publicClient,
        poolConfig,
        networkMode,
      });

      const outputToken: ZapToken = isInputToken0 ? poolConfig.token1.symbol : poolConfig.token0.symbol;
      const outputDecimals = isInputToken0 ? poolConfig.token1.decimals : poolConfig.token0.decimals;

      // Get on-chain share valuation (used by the UI to show $ value).
      let shareValue: ZapPreviewResult['shareValue'] | undefined;
      try {
        const [shareAmount0, shareAmount1] = await publicClient.readContract({
          address: hookAddress,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'previewRemoveReHypothecatedLiquidity',
          args: [preview.expectedShares],
        }) as [bigint, bigint];

        shareValue = {
          amount0: shareAmount0,
          amount1: shareAmount1,
          formatted0: formatUnits(shareAmount0, poolConfig.token0.decimals),
          formatted1: formatUnits(shareAmount1, poolConfig.token1.decimals),
        };
      } catch (e) {
        console.warn('[useZapPreview] Failed to get share valuation:', e);
      }

      const inputTokenAddress = isInputToken0 ? poolConfig.token0.address : poolConfig.token1.address;
      const outputTokenAddress = isInputToken0 ? poolConfig.token1.address : poolConfig.token0.address;

      const result: ZapPreviewResult = {
        swapAmount: preview.swapAmount,
        swapOutputAmount: preview.swapOutput,
        remainingInputAmount: preview.remainingInput,
        route: preview.route,
        expectedShares: preview.expectedShares,
        formatted: {
          inputAmount,
          swapAmount: formatUnits(preview.swapAmount, inputDecimals),
          expectedShares: formatUnits(preview.expectedShares, 18),
        },
        inputTokenInfo: {
          symbol: inputToken,
          decimals: inputDecimals,
          address: inputTokenAddress,
        },
        outputTokenInfo: {
          symbol: outputToken,
          decimals: outputDecimals,
          address: outputTokenAddress,
        },
        shareValue,
        timestamp: Date.now(),
      };

      return result;
    },
    enabled: enabled && !!inputToken && !!inputAmount && parseFloat(inputAmount || '0') > 0 && !!hookAddress && !!publicClient,
    staleTime: 10_000,
    gcTime: MAX_PREVIEW_AGE_MS * 2,
    refetchOnMount: 'always',
    refetchInterval: refetchEnabled ? 10_000 : false,
    retry: 1,
  });
}

export function isPreviewFresh(preview: ZapPreviewResult | null | undefined): boolean {
  if (!preview) return false;
  return Date.now() - preview.timestamp < MAX_PREVIEW_AGE_MS;
}
