/**
 * Fetches and transforms liquidity data for the D3 chart.
 * Transforms price0 based on priceInverted (chart is agnostic to inversion).
 *
 * IMPORTANT: Uses SDK-based tick-to-price conversion when token info is provided
 * to ensure consistency with range prices displayed in the UI.
 */

import { useState, useEffect, useMemo } from 'react';
import { Currency } from '@uniswap/sdk-core';
import { getPoolSubgraphId } from '@/lib/pools-config';
import { tickToPriceSimple, tickToPriceNumber } from '@/lib/liquidity/utils/tick-price';

export interface ChartEntry {
  tick: number;
  price0: number;
  price1: number;
  activeLiquidity: number;
}

interface UseLiquidityChartDataParams {
  poolId?: string;
  priceInverted: boolean;
  /** SDK token0 for proper decimal handling in price conversion */
  token0?: Currency;
  /** SDK token1 for proper decimal handling in price conversion */
  token1?: Currency;
}

interface UseLiquidityChartDataResult {
  liquidityData: ChartEntry[];
  isLoading: boolean;
  error: Error | null;
}

export function useLiquidityChartData({
  poolId,
  priceInverted,
  token0,
  token1,
}: UseLiquidityChartDataParams): UseLiquidityChartDataResult {
  const [rawData, setRawData] = useState<ChartEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Get the subgraph pool ID for API calls
  const subgraphPoolId = poolId ? (getPoolSubgraphId(poolId) || poolId) : undefined;

  // Fetch raw liquidity data
  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (!poolId || !subgraphPoolId) {
        setRawData([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const resp = await fetch('/api/liquidity/get-ticks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId: subgraphPoolId, first: 500 }),
        });

        if (!resp.ok) throw new Error(`API failed: ${resp.status}`);

        const json = await resp.json();
        const ticks = Array.isArray(json?.ticks) ? json.ticks : [];

        if (cancelled) return;

        // Convert ticks to ChartEntry format (canonical prices)
        const sortedTicks = [...ticks].sort((a: any, b: any) =>
          parseInt(a.tickIdx) - parseInt(b.tickIdx)
        );

        let cumulativeLiquidity = 0;
        const chartEntries: ChartEntry[] = [];

        for (const tick of sortedTicks) {
          const tickIdx = parseInt(tick.tickIdx);
          const liquidityNet = parseFloat(tick.liquidityNet);

          if (!isNaN(tickIdx) && !isNaN(liquidityNet)) {
            cumulativeLiquidity += liquidityNet;

            // Use SDK-based conversion when token info available for proper decimal handling
            // This ensures consistency with the range prices displayed in the UI
            let price0: number;
            if (token0 && token1) {
              const sdkPrice = tickToPriceNumber(tickIdx, token0, token1);
              price0 = sdkPrice !== undefined ? sdkPrice : tickToPriceSimple(tickIdx);
            } else {
              // Fallback to simple conversion if tokens not available
              price0 = tickToPriceSimple(tickIdx);
            }

            chartEntries.push({
              tick: tickIdx,
              price0,
              price1: 1 / price0,
              activeLiquidity: Math.max(0, cumulativeLiquidity),
            });
          }
        }

        setRawData(chartEntries);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to fetch liquidity data'));
          setRawData([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [poolId, subgraphPoolId, token0, token1]);

  // Transform and sort by price0 (inverts if needed)
  const liquidityData = useMemo(() => {
    if (rawData.length === 0) return rawData;

    if (!priceInverted) {
      return [...rawData].sort((a, b) => a.price0 - b.price0);
    }

    return rawData
      .map(entry => ({
        ...entry,
        price0: 1 / entry.price0,
        price1: entry.price0,
      }))
      .sort((a, b) => a.price0 - b.price0);
  }, [rawData, priceInverted]);

  return {
    liquidityData,
    isLoading,
    error,
  };
}
