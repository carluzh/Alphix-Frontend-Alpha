/**
 * Apollo Cache Invalidation
 *
 * Matches Uniswap's 2-layer pattern exactly:
 * Layer 1: Update cache immediately (cache.writeQuery)
 * Layer 2: After 3s delay, refetch queries (refetchQueries)
 *
 * @see interface/packages/uniswap/src/features/portfolio/portfolioUpdates/rest/refetchRestQueriesViaOnchainOverrideVariantSaga.ts
 */

import { apolloClient } from '../client'
import { gql } from '@apollo/client'
import { getStoredNetworkMode } from '@/lib/network-mode'

// Query document for cache operations
const USER_POSITIONS_QUERY = gql`
  query UserPositions($owner: String!, $chain: String!) {
    userPositions(owner: $owner, chain: $chain) @client
  }
`

// Matches Uniswap's REFETCH_DELAY = ONE_SECOND_MS * 3
const REFETCH_DELAY = 3000

export type OptimisticUpdates = {
  tvlDelta?: number
  volumeDelta?: number
  positionUpdates?: Array<{
    positionId: string
    liquidity0Delta?: number
    liquidity1Delta?: number
  }>
  addPendingPosition?: {
    positionId: string
    poolId: string
    tickLower: number
    tickUpper: number
    isPending: true
  }
  removePosition?: {
    positionId: string
  }
  clearFees?: {
    positionId: string
  }
}

type Params = {
  owner: string
  chainId: number
  poolId?: string
  positionIds?: string[]
  optimisticUpdates?: OptimisticUpdates
  clearOptimisticStates?: () => void
}

/**
 * Invalidate caches after a transaction
 *
 * Uniswap's 2-layer pattern:
 * Layer 1: Update cache immediately with optimistic data
 * Layer 2: After 3s delay, refetch all active queries
 */
export async function invalidateAfterTx(_qc: any, params: Params) {
  const client = apolloClient
  const ownerLc = (params.owner || '').toLowerCase()
  const networkMode = getStoredNetworkMode()
  const chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'

  // === LAYER 1: Update cache immediately ===
  if (params.optimisticUpdates) {
    updateCacheImmediately(client, ownerLc, chain, params)
  }

  // === LAYER 2: Delay then refetch ===
  await delay(REFETCH_DELAY)
  await client.refetchQueries({ include: 'active' })

  // Clear optimistic states after real data arrives
  if (params.clearOptimisticStates) {
    params.clearOptimisticStates()
  }

  // Trigger wallet balance refresh
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('walletBalancesRefresh'))
  }
}

/**
 * Layer 1: Update cache immediately
 * Matches Uniswap's SharedQueryClient.setQueryData / cache.writeQuery pattern
 */
function updateCacheImmediately(
  client: typeof apolloClient,
  ownerLc: string,
  chain: string,
  params: Params
) {
  const updates = params.optimisticUpdates!

  // Pool stats updates
  if (params.poolId && (updates.tvlDelta !== undefined || updates.volumeDelta !== undefined)) {
    client.cache.modify({
      id: client.cache.identify({ __typename: 'Pool', chain, poolId: params.poolId }),
      fields: {
        tvlUSD: (existing) => updates.tvlDelta !== undefined
          ? Math.max(0, (existing || 0) + updates.tvlDelta)
          : existing,
        volume24hUSD: (existing) => updates.volumeDelta !== undefined
          ? Math.max(0, (existing || 0) + updates.volumeDelta)
          : existing,
      },
    })
  }

  // Position updates
  if (updates.positionUpdates?.length) {
    const existingData = client.cache.readQuery({
      query: USER_POSITIONS_QUERY,
      variables: { owner: ownerLc, chain },
    }) as any

    if (existingData?.userPositions) {
      const updatedPositions = existingData.userPositions.map((position: any) => {
        const update = updates.positionUpdates!.find(u => u.positionId === position.positionId)
        if (!update) return position

        return {
          ...position,
          token0: update.liquidity0Delta !== undefined ? {
            ...position.token0,
            amount: String(Math.max(0, parseFloat(position.token0?.amount || '0') + update.liquidity0Delta))
          } : position.token0,
          token1: update.liquidity1Delta !== undefined ? {
            ...position.token1,
            amount: String(Math.max(0, parseFloat(position.token1?.amount || '0') + update.liquidity1Delta))
          } : position.token1,
          isOptimisticallyUpdating: true,
        }
      })

      client.cache.writeQuery({
        query: USER_POSITIONS_QUERY,
        variables: { owner: ownerLc, chain },
        data: { userPositions: updatedPositions },
      })
    }
  }

  // Add pending position
  if (updates.addPendingPosition) {
    const existingData = client.cache.readQuery({
      query: USER_POSITIONS_QUERY,
      variables: { owner: ownerLc, chain },
    }) as any

    const pending = updates.addPendingPosition
    const skeleton = {
      __typename: 'Position',
      chain,
      positionId: pending.positionId,
      poolId: pending.poolId,
      tickLower: pending.tickLower,
      tickUpper: pending.tickUpper,
      isPending: true,
      isOptimisticallyUpdating: true,
      owner: ownerLc,
      token0: { address: '', symbol: '...', amount: '0', rawAmount: '0' },
      token1: { address: '', symbol: '...', amount: '0', rawAmount: '0' },
      liquidityRaw: '0',
      ageSeconds: 0,
      blockTimestamp: Math.floor(Date.now() / 1000),
      lastTimestamp: Math.floor(Date.now() / 1000),
      isInRange: true,
    }

    client.cache.writeQuery({
      query: USER_POSITIONS_QUERY,
      variables: { owner: ownerLc, chain },
      data: {
        userPositions: [skeleton, ...(existingData?.userPositions || [])],
      },
    })
  }

  // Remove position
  if (updates.removePosition) {
    const existingData = client.cache.readQuery({
      query: USER_POSITIONS_QUERY,
      variables: { owner: ownerLc, chain },
    }) as any

    if (existingData?.userPositions) {
      const updatedPositions = existingData.userPositions.map((position: any) =>
        position.positionId === updates.removePosition!.positionId
          ? { ...position, isRemoving: true, isOptimisticallyUpdating: true }
          : position
      )

      client.cache.writeQuery({
        query: USER_POSITIONS_QUERY,
        variables: { owner: ownerLc, chain },
        data: { userPositions: updatedPositions },
      })
    }
  }

  // Clear fees
  if (updates.clearFees) {
    client.cache.evict({ fieldName: 'uncollectedFees' })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
