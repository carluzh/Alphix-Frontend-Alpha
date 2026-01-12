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

import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { TokenSymbol } from '@/lib/pools-config';
import type { MintTxApiResponse } from '@/lib/liquidity/transaction/context/buildLiquidityTxContext';

// =============================================================================
// TYPES
// =============================================================================

export interface PrepareMintQueryParams {
  userAddress: Address | undefined;
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
  /** Gas limit from response (in wei as bigint) */
  gasLimit: bigint | undefined;
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
        throw new Error(errorData.message || 'Failed to prepare transaction');
      }

      return response.json();
    },
    enabled: isEnabled,
    refetchInterval: options?.refetchInterval ?? 5000, // Match Uniswap's 5 second polling
    staleTime: options?.staleTime ?? 5000,
    retry: false, // Don't retry on failure (Uniswap pattern)
  });

  // Extract gasLimit from response
  const gasLimit = (() => {
    if (!data) return undefined;
    const gasLimitStr = data.create?.gasLimit || data.transaction?.gasLimit;
    if (!gasLimitStr) return undefined;
    try {
      return BigInt(gasLimitStr);
    } catch {
      return undefined;
    }
  })();

  return {
    data,
    isLoading,
    error: error as Error | null,
    refetch,
    gasLimit,
  };
}
