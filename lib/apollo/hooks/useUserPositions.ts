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
import { useNetwork } from '@/lib/network-context'
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
export function useUserPositions(ownerAddress: string): UseUserPositionsResult {
  const { networkMode } = useNetwork()
  const chain: Chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'
  const ownerLc = (ownerAddress || '').toLowerCase()
  const enabled = !!ownerLc && ownerLc.length > 0

  // Chain-based polling interval (L2 = 3s base, x10 for positions = 30s)
  const chainPollingInterval = usePollingIntervalByChain()

  // Adaptive fetch policy - reduces polling when window not visible
  const { fetchPolicy, pollInterval } = usePlatformBasedFetchPolicy({
    fetchPolicy: 'cache-and-network',
    pollInterval: chainPollingInterval * 10, // ~30 seconds - positions can change after transactions
  })

  const { data, loading, error, refetch } = useGetUserPositionsQuery({
    variables: { chain, owner: ownerLc },
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
