/**
 * Apollo Cache Invalidation
 *
 * Handles cache invalidation after transactions.
 * Replaces the React Query invalidation from lib/invalidation.ts
 *
 * Uses Apollo's cache.evict() and cache.modify() for precise invalidation.
 */

import { apolloClient } from '../client'
import { gql } from '@apollo/client'
import { getStoredNetworkMode, MAINNET_CHAIN_ID } from '@/lib/network-mode'
import { prefetchService } from '@/lib/prefetch-service'

// Query for writing positions to cache
const USER_POSITIONS_QUERY = gql`
  query UserPositions($owner: String!, $chain: String!) {
    userPositions(owner: $owner, chain: $chain) @client
  }
`

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
  reason?: string
  awaitSubgraphSync?: boolean
  blockNumber?: bigint
  reloadPositions?: boolean
  onPositionsReloaded?: (positions: any[]) => void
  clearOptimisticStates?: () => void
  refreshPoolData?: () => Promise<void>
  optimisticUpdates?: OptimisticUpdates
}

/**
 * Invalidate caches after a transaction
 *
 * This function orchestrates cache invalidation across multiple layers:
 * 1. Optimistic updates (immediate UI feedback)
 * 2. Subgraph sync coordination (wait for indexing)
 * 3. Redis cache invalidation (server-side)
 * 4. Apollo cache invalidation (client-side)
 *
 * @param _qc - QueryClient (ignored, kept for backward compatibility)
 * @param params - Invalidation parameters
 */
export async function invalidateAfterTx(_qc: any, params: Params) {
  const client = apolloClient
  const ownerLc = (params.owner || '').toLowerCase()
  const networkMode = getStoredNetworkMode()
  const chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'

  try {
    const hasOptimisticUpdates = !!params.optimisticUpdates

    if (hasOptimisticUpdates) {
      try {
        // Handle pool stats updates (TVL, volume)
        if (params.poolId && (params.optimisticUpdates!.tvlDelta !== undefined || params.optimisticUpdates!.volumeDelta !== undefined)) {
          client.cache.modify({
            id: client.cache.identify({ __typename: 'Pool', chain, poolId: params.poolId }),
            fields: {
              tvlUSD: (existing) => {
                if (params.optimisticUpdates!.tvlDelta !== undefined) {
                  return Math.max(0, (existing || 0) + params.optimisticUpdates!.tvlDelta)
                }
                return existing
              },
              volume24hUSD: (existing) => {
                if (params.optimisticUpdates!.volumeDelta !== undefined) {
                  return Math.max(0, (existing || 0) + params.optimisticUpdates!.volumeDelta)
                }
                return existing
              },
            },
          })
        }

        // Handle position liquidity updates
        if (params.optimisticUpdates!.positionUpdates?.length) {
          const existingData = client.cache.readQuery({
            query: USER_POSITIONS_QUERY,
            variables: { owner: ownerLc, chain },
          }) as any

          if (existingData?.userPositions) {
            const updatedPositions = existingData.userPositions.map((position: any) => {
              const update = params.optimisticUpdates!.positionUpdates!.find(
                (u) => u.positionId === position.positionId
              )
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

        // Handle adding pending position (mint - show skeleton)
        if (params.optimisticUpdates!.addPendingPosition) {
          const existingData = client.cache.readQuery({
            query: USER_POSITIONS_QUERY,
            variables: { owner: ownerLc, chain },
          }) as any

          const pending = params.optimisticUpdates!.addPendingPosition!
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

        // Handle removing position (burn)
        if (params.optimisticUpdates!.removePosition) {
          const existingData = client.cache.readQuery({
            query: USER_POSITIONS_QUERY,
            variables: { owner: ownerLc, chain },
          }) as any

          if (existingData?.userPositions) {
            const positionId = params.optimisticUpdates!.removePosition!.positionId
            const updatedPositions = existingData.userPositions.map((position: any) =>
              position.positionId === positionId
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

        // Handle fee claim
        if (params.optimisticUpdates!.clearFees) {
          const positionId = params.optimisticUpdates!.clearFees.positionId

          // Evict the specific position's fees from cache
          client.cache.evict({
            id: client.cache.identify({ __typename: 'FeeItem', positionId }),
          })

          // Also evict any uncollected fees queries that might contain this position
          client.cache.evict({
            fieldName: 'uncollectedFees',
          })
        }
      } catch (error) {
        console.error('[invalidateAfterTx] Optimistic update failed:', error)
      }
    }

    if (hasOptimisticUpdates && !params.awaitSubgraphSync) {
      return
    }

    // Wait for subgraph sync if requested
    if (params.awaitSubgraphSync) {
      try {
        const { createNetworkClient } = await import('@/lib/viemClient')
        const { waitForSubgraphBlock, setIndexingBarrier } = await import('@/lib/client-cache')

        const publicClient = createNetworkClient(networkMode)
        const targetBlock = params.blockNumber ?? await publicClient.getBlockNumber()
        const barrier = waitForSubgraphBlock(Number(targetBlock), {
          timeoutMs: 15000,
          minWaitMs: 800,
          maxIntervalMs: 1500
        })
        setIndexingBarrier(ownerLc, barrier)
        await barrier

        if (params.refreshPoolData) {
          await params.refreshPoolData()
        }
      } catch (error) {
        console.error('[invalidateAfterTx] Subgraph sync failed:', error)
      }
    }

    // Evict user positions from cache to trigger refetch
    client.cache.evict({
      fieldName: 'userPositions',
      args: { owner: ownerLc, chain },
    })

    // Evict uncollected fees
    if (params.positionIds && params.positionIds.length > 0) {
      client.cache.evict({
        fieldName: 'uncollectedFees',
      })
    }

    // Evict pool data
    if (params.poolId) {
      client.cache.evict({
        id: client.cache.identify({ __typename: 'Pool', chain, poolId: params.poolId }),
      })
      client.cache.evict({
        id: client.cache.identify({ __typename: 'PoolState', chain, poolId: params.poolId }),
      })
    }

    // Garbage collect orphaned cache entries
    client.cache.gc()

    // Invalidate Redis caches (server-side) via API call
    try {
      const requestBody = {
        ownerAddress: ownerLc,
        poolId: params.poolId,
        positionIds: params.positionIds,
        reason: params.reason || 'tx_confirmed'
      }

      const response = await fetch('/api/cache/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[invalidateAfterTx] Redis invalidation failed:', response.status, errorText)
      }
    } catch (error) {
      console.error('[invalidateAfterTx] Redis cache invalidation failed:', error)
    }

    // Reload positions if requested
    if (params.reloadPositions) {
      try {
        const { loadUserPositionIds, getCachedPositionTimestamps } = await import('@/lib/client-cache')
        const { derivePositionsFromIds } = await import('@/lib/on-chain-data')
        const ids = await loadUserPositionIds(ownerLc)
        const timestamps = getCachedPositionTimestamps(ownerLc)
        const allDerived = await derivePositionsFromIds(ownerLc, ids, params.chainId, timestamps)

        // Write fresh positions to cache
        client.cache.writeQuery({
          query: USER_POSITIONS_QUERY,
          variables: { owner: ownerLc, chain },
          data: {
            userPositions: allDerived.map((p: any) => ({
              __typename: 'Position',
              chain,
              ...p,
            })),
          },
        })

        if (params.onPositionsReloaded) {
          params.onPositionsReloaded(allDerived)
        }
      } catch (error) {
        console.error('[invalidateAfterTx] Position reload failed:', error)
      }
    }

    if (params.clearOptimisticStates) {
      try {
        params.clearOptimisticStates()
      } catch (error) {
        console.error('[invalidateAfterTx] Clear optimistic states failed:', error)
      }
    }

    // Notify prefetch service
    try {
      prefetchService.notifyPositionsRefresh(ownerLc, params.reason || 'tx_confirmed')
    } catch {}

    // Trigger wallet balance refresh
    if (typeof window !== 'undefined') {
      localStorage.setItem(`walletBalancesRefreshAt_${ownerLc}`, String(Date.now()))
      window.dispatchEvent(new Event('walletBalancesRefresh'))
    }

  } catch (error) {
    console.error('[invalidateAfterTx] Top-level error:', error)
    if (params.clearOptimisticStates) {
      try {
        params.clearOptimisticStates()
      } catch {}
    }
  }
}
