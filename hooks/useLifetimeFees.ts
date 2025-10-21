/**
 * React Hook: usePositionAPY (Simplified)
 *
 * Calculates APY based on fees earned since last liquidity modification
 */

import { useQuery } from '@tanstack/react-query';
import type { PositionAPYResult } from '@/lib/lifetime-fees';

export interface UsePositionAPYProps {
  owner: string | undefined;
  tickLower: number | undefined;
  tickUpper: number | undefined;
  poolId: string | undefined;
  uncollectedFeesUSD: number | undefined;
  positionValueUSD: number | undefined;
  positionCreationTimestamp: number | undefined;
  enabled?: boolean;
}

export interface UsePositionAPYReturn {
  apy: number | null;
  formattedAPY: string;
  durationDays: number | null;
  lastModificationTimestamp: number | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to calculate position APY based on fees since last liquidity modification
 */
export function usePositionAPY({
  owner,
  tickLower,
  tickUpper,
  poolId,
  uncollectedFeesUSD,
  positionValueUSD,
  positionCreationTimestamp,
  enabled = true,
}: UsePositionAPYProps): UsePositionAPYReturn {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      'position-apy-simple',
      owner,
      tickLower,
      tickUpper,
      poolId,
      uncollectedFeesUSD,
      positionValueUSD,
      positionCreationTimestamp,
    ],
    queryFn: async (): Promise<PositionAPYResult> => {
      if (!owner || tickLower === undefined || tickUpper === undefined || !poolId ||
          uncollectedFeesUSD === undefined || positionValueUSD === undefined || !positionCreationTimestamp) {
        return {
          apy: null,
          formattedAPY: '—',
          durationDays: 0,
          lastModificationTimestamp: null,
        };
      }

      const response = await fetch('/api/liquidity/get-lifetime-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          tickLower,
          tickUpper,
          poolId,
          uncollectedFeesUSD,
          positionValueUSD,
          positionCreationTimestamp,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to calculate APY: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      return {
        apy: result.apy,
        formattedAPY: result.formattedAPY,
        durationDays: result.durationDays,
        lastModificationTimestamp: result.lastModificationTimestamp,
      };
    },
    enabled: enabled && !!owner && tickLower !== undefined && tickUpper !== undefined && !!poolId &&
             uncollectedFeesUSD !== undefined && positionValueUSD !== undefined && !!positionCreationTimestamp,
    staleTime: 30_000, // 30 seconds
    gcTime: 5 * 60_000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  return {
    apy: data?.apy ?? null,
    formattedAPY: data?.formattedAPY ?? '—',
    durationDays: data?.durationDays ?? null,
    lastModificationTimestamp: data?.lastModificationTimestamp ?? null,
    isLoading,
    error: error as Error | null,
  };
}
