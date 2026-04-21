/**
 * usePrepareMintQuery Hook
 *
 * Pre-fetches transaction data for mint operations.
 * Adapted from Uniswap's useCreateLpPositionCalldataQuery pattern.
 *
 * This hook runs in CreatePositionTxContext to provide:
 * - Gas estimate for display before user clicks confirm
 * - Pre-validated transaction data
 *
 * @see interface/apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx
 */

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Address } from 'viem';
import type { TokenSymbol } from '@/lib/pools-config';
import type { MintTxApiResponse } from '@/lib/liquidity/transaction/context/buildLiquidityTxContext';

// =============================================================================
// TYPES
// =============================================================================

export interface PrepareMintQueryParams {
  userAddress: Address | undefined;
  poolId: string | undefined;
  token0Symbol: TokenSymbol | undefined;
  token1Symbol: TokenSymbol | undefined;
  inputAmount: string | undefined;
  inputTokenSymbol: TokenSymbol | undefined;
  tickLower: number | undefined;
  tickUpper: number | undefined;
  chainId: number | undefined;
  slippageBps?: number;
  deadlineMinutes?: number;
}

export interface PrepareMintQueryResult {
  /** API response data */
  data: MintTxApiResponse | undefined;
  /** Whether the query is loading */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
  /** Estimated gas cost in wei from API simulation. */
  gasFee: bigint | undefined;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Pre-fetches mint transaction data.
 *
 * Mirrors Uniswap's useCreateLpPositionCalldataQuery:
 * - Polls every 5 seconds for fresh data
 * - Provides gas estimate for UI display
 * - Returns transaction data ready for execution
 *
 * @param params - Query parameters
 * @param options - Query options
 */
export function usePrepareMintQuery(
  params: PrepareMintQueryParams,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
): PrepareMintQueryResult {
  const {
    userAddress,
    poolId,
    token0Symbol,
    token1Symbol,
    inputAmount,
    inputTokenSymbol,
    tickLower,
    tickUpper,
    chainId,
    slippageBps = 50, // Default 0.5%
    deadlineMinutes = 20,
  } = params;

  // Determine if we have all required params
  const isEnabled =
    options?.enabled !== false &&
    !!userAddress &&
    !!token0Symbol &&
    !!token1Symbol &&
    !!inputAmount &&
    parseFloat(inputAmount) > 0 &&
    !!inputTokenSymbol &&
    tickLower !== undefined &&
    tickUpper !== undefined &&
    tickLower < tickUpper &&
    !!chainId;

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      'prepareMint',
      userAddress,
      poolId,
      token0Symbol,
      token1Symbol,
      inputAmount,
      inputTokenSymbol,
      tickLower,
      tickUpper,
      chainId,
      slippageBps,
    ],
    queryFn: async (): Promise<MintTxApiResponse> => {
      const response = await fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress,
          poolId,
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol,
          userTickLower: tickLower,
          userTickUpper: tickUpper,
          chainId,
          slippageBps,
          deadlineMinutes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.message || 'Failed to prepare transaction') as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      return response.json();
    },
    enabled: isEnabled,
    refetchInterval: options?.refetchInterval ?? 5000, // Match Uniswap's 5 second polling
    staleTime: options?.staleTime ?? 5000,
    // Retry only on 429 (Uniswap rate limit propagated from our route) with a longer
    // backoff than the in-route retry. Other failures surface immediately.
    retry: (failureCount, error) => (error as any)?.status === 429 && failureCount < 2,
    retryDelay: (failureCount) => [1500, 4000][failureCount] ?? 4000,
  });

  // Surface a single toast when the API rate limit survives our in-route + TanStack
  // retries (transient spike absorbed silently; sustained overload becomes visible).
  const lastToastAtRef = useRef(0);
  useEffect(() => {
    if ((error as any)?.status === 429 && Date.now() - lastToastAtRef.current > 10_000) {
      lastToastAtRef.current = Date.now();
      toast.error('Uniswap LP service is busy', {
        description: 'Refresh in a moment — your transaction is not affected.',
      });
    }
  }, [error]);

  const gasFee = (() => {
    if (!data?.gasFee) return undefined;
    try {
      return BigInt(data.gasFee);
    } catch {
      return undefined;
    }
  })();

  return {
    data,
    isLoading,
    error: error as Error | null,
    refetch,
    gasFee,
  };
}
