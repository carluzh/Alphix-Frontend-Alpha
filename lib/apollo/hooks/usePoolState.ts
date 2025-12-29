/**
 * usePoolState Hook
 *
 * Apollo hook for fetching current pool state (on-chain data).
 * Uses generated hook from graphql-codegen.
 *
 * @see interface/packages/api/src/clients/graphql/web/pool.graphql
 */

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
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  refetch: () => void
}

/**
 * Hook to fetch current pool state
 *
 * @param poolId - The pool ID to fetch state for
 * @returns Pool state with loading/error states
 *
 * @example
 * const { data: poolState, isLoading } = usePoolState(poolId)
 * const currentTick = poolState?.tick
 */
export function usePoolState(poolId: string): UsePoolStateResult {
  const { networkMode } = useNetwork()
  const chain: Chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'
  const enabled = !!poolId && poolId.length > 0

  const { data, loading, error, refetch } = useGetPoolStateQuery({
    variables: { chain, poolId },
    skip: !enabled,
    fetchPolicy: 'cache-and-network',
    pollInterval: 45000, // 45 seconds - pool state doesn't change frequently
  })

  return {
    data: data?.poolState as PoolStateData | undefined,
    isLoading: loading,
    isError: !!error,
    error: error as Error | undefined,
    refetch: () => { refetch() },
  }
}
