/**
 * useGasFeeEstimate Hook
 *
 * Calculates gas fee estimate in USD for liquidity transactions.
 * Adapted from Uniswap's useTransactionGasFee + useUSDCurrencyAmountOfGasFee pattern.
 *
 * @see interface/packages/uniswap/src/features/gas/hooks.ts
 * @see interface/apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { useAllPrices } from '@/lib/apollo/hooks/useAllPrices';

// =============================================================================
// TYPES
// =============================================================================

export interface GasFeeEstimateResult {
  /** Gas fee in USD (e.g., "0.12") */
  gasFeeUSD: string | undefined;
  /** Formatted for display (e.g., "$0.12") */
  gasFeeFormatted: string | undefined;
  /** Raw gas cost in wei */
  gasCostWei: bigint | undefined;
  /** Whether the estimate is loading */
  isLoading: boolean;
  /** Error if any */
  error: Error | undefined;
}

export interface UseGasFeeEstimateParams {
  /** Gas limit from API response */
  gasLimit: bigint | undefined;
  /** Chain ID */
  chainId: number | undefined;
  /** Skip the query */
  skip?: boolean;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Estimates gas fee in USD for a transaction.
 *
 * Follows Uniswap's pattern:
 * 1. Get current gas price from chain
 * 2. Calculate gas cost: gasLimit × gasPrice
 * 3. Convert to USD: gasCostWei × ETH_PRICE / 10^18
 *
 * @example
 * const { gasFeeFormatted, isLoading } = useGasFeeEstimate({
 *   gasLimit: txRequest?.gasLimit,
 *   chainId,
 * });
 */
export function useGasFeeEstimate({
  gasLimit,
  chainId,
  skip = false,
}: UseGasFeeEstimateParams): GasFeeEstimateResult {
  const publicClient = usePublicClient({ chainId });
  const { data: prices, loading: pricesLoading } = useAllPrices();

  // Fetch current gas price
  const {
    data: gasPrice,
    isLoading: gasPriceLoading,
    error: gasPriceError,
  } = useQuery({
    queryKey: ['gasPrice', chainId],
    queryFn: async () => {
      if (!publicClient) throw new Error('No public client');
      return publicClient.getGasPrice();
    },
    enabled: !!publicClient && !!chainId && !skip,
    refetchInterval: 15000, // Refresh every 15 seconds
    staleTime: 10000,
  });

  // Calculate gas fee in USD
  const result = useMemo((): GasFeeEstimateResult => {
    // Still loading
    if (gasPriceLoading || pricesLoading) {
      return {
        gasFeeUSD: undefined,
        gasFeeFormatted: undefined,
        gasCostWei: undefined,
        isLoading: true,
        error: undefined,
      };
    }

    // Error fetching gas price
    if (gasPriceError) {
      return {
        gasFeeUSD: undefined,
        gasFeeFormatted: undefined,
        gasCostWei: undefined,
        isLoading: false,
        error: gasPriceError as Error,
      };
    }

    // No gas limit provided
    if (!gasLimit || !gasPrice) {
      return {
        gasFeeUSD: undefined,
        gasFeeFormatted: undefined,
        gasCostWei: undefined,
        isLoading: false,
        error: undefined,
      };
    }

    // Get ETH price
    const ethPriceUSD = prices?.ETH;
    if (!ethPriceUSD) {
      return {
        gasFeeUSD: undefined,
        gasFeeFormatted: undefined,
        gasCostWei: undefined,
        isLoading: false,
        error: undefined,
      };
    }

    // Calculate gas cost in wei: gasLimit × gasPrice
    const gasCostWei = gasLimit * gasPrice;

    // Convert to ETH: gasCostWei / 10^18
    const gasCostETH = parseFloat(formatUnits(gasCostWei, 18));

    // Convert to USD: gasCostETH × ETH_PRICE
    const gasFeeUSD = (gasCostETH * ethPriceUSD).toFixed(2);

    // Format for display
    const gasFeeFormatted = `$${gasFeeUSD}`;

    return {
      gasFeeUSD,
      gasFeeFormatted,
      gasCostWei,
      isLoading: false,
      error: undefined,
    };
  }, [gasLimit, gasPrice, prices, gasPriceLoading, pricesLoading, gasPriceError]);

  return result;
}

/**
 * Calculates total gas fee from multiple transactions.
 *
 * Used when position creation requires multiple steps:
 * - Token0 approval
 * - Token1 approval
 * - Permit signature (no gas)
 * - Position creation
 *
 * @example
 * const { gasFeeFormatted } = useMultiStepGasFeeEstimate({
 *   gasLimits: [approvalGas0, approvalGas1, createGas],
 *   chainId,
 * });
 */
export function useMultiStepGasFeeEstimate({
  gasLimits,
  chainId,
  skip = false,
}: {
  gasLimits: (bigint | undefined)[];
  chainId: number | undefined;
  skip?: boolean;
}): GasFeeEstimateResult {
  // Calculate total gas limit
  const totalGasLimit = useMemo(() => {
    const validLimits = gasLimits.filter((g): g is bigint => g !== undefined);
    if (validLimits.length === 0) return undefined;
    return validLimits.reduce((sum, g) => sum + g, 0n);
  }, [gasLimits]);

  return useGasFeeEstimate({
    gasLimit: totalGasLimit,
    chainId,
    skip,
  });
}
