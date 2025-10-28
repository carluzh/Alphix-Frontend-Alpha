import { useQuery } from '@tanstack/react-query';

interface ChartDataPoint {
  timestamp: number;
  price: number;
}

export function usePoolChartData(token0?: string, token1?: string) {
  return useQuery({
    queryKey: ['pools', 'chart', token0, token1],
    queryFn: async ({ signal }) => {
      if (!token0 || !token1) {
        console.log('[usePoolChartData] Missing tokens:', { token0, token1 });
        return { data: [] };
      }

      console.log('[usePoolChartData] Fetching chart data for:', token0, token1);

      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch(
          `/api/liquidity/get-pool-chart?token0=${token0}&token1=${token1}`,
          { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error('[usePoolChartData] HTTP error:', response.status, response.statusText);
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('[usePoolChartData] Received data:', {
          dataPoints: result?.data?.length || 0,
          cached: result?.cached
        });
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('[usePoolChartData] Request timed out after 30 seconds');
          throw new Error('Request timed out');
        }
        throw error;
      }
    },
    enabled: !!token0 && !!token1,
    staleTime: 15 * 60 * 1000, // 15 minutes - historical data changes slowly
    gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache longer
    retry: 1,
  });
}

export function usePoolLiquidityTicks(poolId?: string) {
  console.log('[usePoolLiquidityTicks] Hook called with poolId:', poolId, 'enabled:', !!poolId);

  return useQuery({
    queryKey: ['pool-ticks', poolId],
    queryFn: async ({ signal }) => {
      console.log('[usePoolLiquidityTicks] queryFn executing for poolId:', poolId);

      if (!poolId) {
        console.log('[usePoolLiquidityTicks] Missing poolId in queryFn');
        return { ticks: [] };
      }

      console.log('[usePoolLiquidityTicks] Fetching ticks for pool:', poolId);

      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch('/api/liquidity/get-ticks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            poolId,
            first: 1000
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error('[usePoolLiquidityTicks] HTTP error:', response.status, response.statusText);
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('[usePoolLiquidityTicks] Received ticks:', {
          tickCount: result?.ticks?.length || 0,
          cached: result?.cached
        });
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('[usePoolLiquidityTicks] Request timed out after 30 seconds');
          throw new Error('Request timed out');
        }
        throw error;
      }
    },
    enabled: !!poolId,
    staleTime: 5 * 60 * 1000, // 5 minutes - matches server cache
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
  });
}
