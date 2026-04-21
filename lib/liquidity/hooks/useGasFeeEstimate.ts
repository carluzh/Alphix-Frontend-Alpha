/**
 * useGasFeeEstimate Hook
 *
 * Converts a wei-denominated gas fee (from Uniswap LP API simulation) into
 * a USD-formatted display string.
 */

import { useMemo } from 'react';
import { formatUnits } from 'viem';
import { useTokenPrices } from '@/hooks/useTokenPrices';

export interface GasFeeEstimateResult {
  /** Gas fee in USD (e.g., "0.12") */
  gasFeeUSD: string | undefined;
  /** Formatted for display (e.g., "$0.12") */
  gasFeeFormatted: string | undefined;
  /** Raw gas cost in wei (echo of input) */
  gasCostWei: bigint | undefined;
  /** Whether ETH price is loading */
  isLoading: boolean;
}

export interface UseGasFeeEstimateParams {
  /** Gas fee in wei from API simulation (response.gasFee). */
  gasFeeWei: bigint | undefined;
  /** Skip the conversion */
  skip?: boolean;
}

export function useGasFeeEstimate({
  gasFeeWei,
  skip = false,
}: UseGasFeeEstimateParams): GasFeeEstimateResult {
  const { prices, isLoading: pricesLoading } = useTokenPrices(['ETH'], { pollInterval: 60_000 });

  return useMemo((): GasFeeEstimateResult => {
    if (skip || !gasFeeWei) {
      return { gasFeeUSD: undefined, gasFeeFormatted: undefined, gasCostWei: gasFeeWei, isLoading: false };
    }
    if (pricesLoading) {
      return { gasFeeUSD: undefined, gasFeeFormatted: undefined, gasCostWei: gasFeeWei, isLoading: true };
    }
    const ethPriceUSD = prices.ETH;
    if (!ethPriceUSD) {
      return { gasFeeUSD: undefined, gasFeeFormatted: undefined, gasCostWei: gasFeeWei, isLoading: false };
    }
    const gasCostETH = parseFloat(formatUnits(gasFeeWei, 18));
    const gasFeeUSD = (gasCostETH * ethPriceUSD).toFixed(2);
    return {
      gasFeeUSD,
      gasFeeFormatted: `$${gasFeeUSD}`,
      gasCostWei: gasFeeWei,
      isLoading: false,
    };
  }, [gasFeeWei, prices, pricesLoading, skip]);
}
