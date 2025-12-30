/**
 * usePoolState Hook
 *
 * Apollo hook for fetching current pool state (on-chain data).
 * Uses generated hook from graphql-codegen.
 *
 * @see interface/packages/api/src/clients/graphql/web/pool.graphql
 */

import { usePlatformBasedFetchPolicy } from '@/hooks/usePlatformBasedFetchPolicy'
import { usePollingIntervalByChain } from '@/hooks/usePollingIntervalByChain'
import { useNetwork } from '@/lib/network-context'
import { useGetPoolStateQuery, type Chain } from '../__generated__'

interface PoolStateData {
  poolId: string
  sqrtPriceX96: string
  tick: number
  liquidity: string
  currentPrice: string
  currentPoolTick: number
  protocolFee: number
  lpFee: number
}

interface UsePoolStateResult {
  data: PoolStateData | undefined
  loading: boolean
  error: boolean
  errorDetails: Error | undefined
  refetch: () => Promise<void>
}

/**
 * Hook to fetch current pool state
 *
 * @param poolId - The pool ID to fetch state for
 * @returns Pool state with loading/error states
 *
 * @example
 * const { data: poolState, loading } = usePoolState(poolId)
 * const currentTick = poolState?.tick
 */
export function usePoolState(poolId: string): UsePoolStateResult {
  const { networkMode } = useNetwork()
  const chain: Chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'
  const enabled = !!poolId && poolId.length > 0

  // Chain-based polling interval (L2 = 3s base, x15 for pool state = 45s)
  const chainPollingInterval = usePollingIntervalByChain()

  // Adaptive fetch policy - reduces polling when window not visible
  const { fetchPolicy, pollInterval } = usePlatformBasedFetchPolicy({
    fetchPolicy: 'cache-and-network',
    pollInterval: chainPollingInterval * 15, // ~45 seconds - pool state doesn't change frequently
  })

  const { data, loading, error, refetch } = useGetPoolStateQuery({
    variables: { chain, poolId },
    skip: !enabled,
    fetchPolicy,
    pollInterval,
  })

  return {
    data: data?.poolState as PoolStateData | undefined,
    loading: loading,
    error: !!error,
    errorDetails: error as Error | undefined,
    refetch: async () => { await refetch() },
  }
}
