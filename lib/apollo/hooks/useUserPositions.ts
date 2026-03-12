/**
 * useUserPositions Hook
 *
 * Apollo hook for fetching user's liquidity positions.
 * Uses generated hook from graphql-codegen.
 *
 * @see interface/packages/api/src/clients/graphql/web/positions.graphql
 */

import { usePlatformBasedFetchPolicy } from '@/hooks/usePlatformBasedFetchPolicy'
import { usePollingIntervalByChain } from '@/hooks/usePollingIntervalByChain'
import { apolloChainForMode } from '@/lib/network-mode'
import { useGetUserPositionsQuery, type Chain } from '../__generated__'

interface PositionToken {
  address: string
  symbol: string
  amount: string
  rawAmount: string
}

interface Position {
  id: string
  chain: string
  positionId: string
  owner: string
  poolId: string
  token0: PositionToken
  token1: PositionToken
  tickLower: number
  tickUpper: number
  liquidity: string
  ageSeconds: number
  blockTimestamp: number
  lastTimestamp: number
  isInRange: boolean
  token0UncollectedFees?: string
  token1UncollectedFees?: string
}

interface UseUserPositionsResult {
  data: Position[] | undefined
  loading: boolean
  isFetching: boolean
  error: boolean
  errorDetails: Error | undefined
  refetch: () => Promise<void>
}

/**
 * Hook to fetch user's liquidity positions
 *
 * @param ownerAddress - The wallet address of the position owner
 * @returns Positions data with loading/error states
 *
 * @example
 * const { data: positions, loading } = useUserPositions(address)
 */
export function useUserPositions(ownerAddress: string, networkModeOverride?: import('@/lib/network-mode').NetworkMode): UseUserPositionsResult {
  const networkMode = networkModeOverride
  const chain = networkMode ? apolloChainForMode(networkMode) as Chain : undefined
  const ownerLc = (ownerAddress || '').toLowerCase()
  const enabled = !!ownerLc && ownerLc.length > 0 && !!networkMode

  const chainPollingInterval = usePollingIntervalByChain()

  const { fetchPolicy, pollInterval } = usePlatformBasedFetchPolicy({
    fetchPolicy: 'cache-and-network',
    pollInterval: chainPollingInterval * 10,
  })

  const { data, loading, error, refetch } = useGetUserPositionsQuery({
    variables: { chain: chain!, owner: ownerLc },
    context: { networkMode: networkMode! },
    skip: !enabled,
    fetchPolicy,
    pollInterval,
  })

  return {
    data: data?.userPositions as Position[] | undefined,
    loading: loading && !data?.userPositions,
    isFetching: loading,
    error: !!error,
    errorDetails: error as Error | undefined,
    refetch: async () => { await refetch() },
  }
}
