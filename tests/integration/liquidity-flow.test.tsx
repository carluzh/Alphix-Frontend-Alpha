/**
 * Integration tests for liquidity flow with new cache system
 * Tests the complete user journey: connect wallet → add liquidity → see position
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAddLiquidityMutation } from '@/lib/cache/client/mutations'
import { queryKeys } from '@/lib/cache/client/query-keys'
import { setIndexingBarrier, clearAllBarriers } from '@/lib/cache/coordination/barriers'

// Mock fetch
global.fetch = vi.fn()

describe('Liquidity Flow Integration', () => {
  let queryClient: QueryClient

  const mockAddress = '0x1234567890abcdef1234567890abcdef12345678'
  const mockPoolId = 'pool-eth-usdc'

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    clearAllBarriers()
    vi.clearAllMocks()

    // Mock successful server responses
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (typeof url === 'string') {
        // Mock subgraph head endpoint
        if (url.includes('/api/liquidity/subgraph-head')) {
          return {
            ok: true,
            json: async () => ({ subgraphHead: 1000 }),
          } as Response
        }

        // Mock revalidate endpoint
        if (url.includes('/api/internal/revalidate-pools')) {
          return {
            ok: true,
            json: async () => ({ revalidated: true }),
          } as Response
        }
      }

      return { ok: false } as Response
    })
  })

  it('should complete add liquidity flow and invalidate caches', async () => {
    // Setup: Pre-populate cache with position data
    const initialPositions = [
      { id: 'pos-1', poolId: mockPoolId, liquidity: '1000' },
    ]
    queryClient.setQueryData(queryKeys.user.positions(mockAddress), initialPositions)

    // Execute: Add liquidity mutation
    const { result } = renderHook(() => useAddLiquidityMutation(), { wrapper })

    const addLiquidityParams = {
      poolId: mockPoolId,
      owner: mockAddress,
      amount0: '100',
      amount1: '100',
      tickLower: -1000,
      tickUpper: 1000,
    }

    // Mock the actual transaction execution
    vi.mock('@/components/liquidity/useIncreaseLiquidity', () => ({
      executeAddLiquidity: vi.fn().mockResolvedValue({
        hash: '0xabc123',
        blockNumber: 1000,
        status: 'success',
      }),
    }))

    // Trigger mutation
    result.current.mutate(addLiquidityParams)

    // Wait for mutation to complete
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    // Assert: Position cache should be invalidated
    const cachedPositions = queryClient.getQueryData(
      queryKeys.user.positions(mockAddress)
    )
    expect(cachedPositions).toBeUndefined() // Cache was invalidated

    // Assert: Pool cache should be invalidated
    const cachedPoolStats = queryClient.getQueryData(queryKeys.pools.stats(mockPoolId))
    expect(cachedPoolStats).toBeUndefined()

    // Assert: Server revalidation was triggered
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/revalidate-pools',
      expect.objectContaining({
        method: 'POST',
      })
    )
  })

  it('should set and wait for indexing barrier', async () => {
    const { result } = renderHook(() => useAddLiquidityMutation(), { wrapper })

    const addLiquidityParams = {
      poolId: mockPoolId,
      owner: mockAddress,
      amount0: '100',
      amount1: '100',
      tickLower: -1000,
      tickUpper: 1000,
    }

    // Mock transaction execution
    vi.mock('@/components/liquidity/useIncreaseLiquidity', () => ({
      executeAddLiquidity: vi.fn().mockResolvedValue({
        hash: '0xabc123',
        blockNumber: 1000,
        status: 'success',
      }),
    }))

    result.current.mutate(addLiquidityParams)

    // Barrier should be set immediately after mutation starts
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })

    // Assert: Subgraph head was polled
    expect(fetch).toHaveBeenCalledWith(
      '/api/liquidity/subgraph-head',
      expect.any(Object)
    )
  })

  it('should handle transaction failure gracefully', async () => {
    const onError = vi.fn()

    const { result } = renderHook(() => useAddLiquidityMutation({ onError }), {
      wrapper,
    })

    const addLiquidityParams = {
      poolId: mockPoolId,
      owner: mockAddress,
      amount0: '100',
      amount1: '100',
      tickLower: -1000,
      tickUpper: 1000,
    }

    // Mock transaction failure
    vi.mock('@/components/liquidity/useIncreaseLiquidity', () => ({
      executeAddLiquidity: vi.fn().mockRejectedValue(new Error('Transaction failed')),
    }))

    result.current.mutate(addLiquidityParams)

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    // Assert: Error callback was called
    expect(onError).toHaveBeenCalled()

    // Assert: Caches should NOT be invalidated on failure
    const cachedPositions = queryClient.getQueryData(
      queryKeys.user.positions(mockAddress)
    )
    expect(cachedPositions).toBeDefined() // Cache still present
  })

  it('should proceed if subgraph indexing times out', async () => {
    // Mock slow subgraph (never catches up)
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/liquidity/subgraph-head')) {
        return {
          ok: true,
          json: async () => ({ subgraphHead: 999 }), // Always behind target block
        } as Response
      }

      if (typeof url === 'string' && url.includes('/api/internal/revalidate-pools')) {
        return {
          ok: true,
          json: async () => ({ revalidated: true }),
        } as Response
      }

      return { ok: false } as Response
    })

    const { result } = renderHook(() => useAddLiquidityMutation(), { wrapper })

    const addLiquidityParams = {
      poolId: mockPoolId,
      owner: mockAddress,
      amount0: '100',
      amount1: '100',
      tickLower: -1000,
      tickUpper: 1000,
    }

    vi.mock('@/components/liquidity/useIncreaseLiquidity', () => ({
      executeAddLiquidity: vi.fn().mockResolvedValue({
        hash: '0xabc123',
        blockNumber: 1000,
        status: 'success',
      }),
    }))

    result.current.mutate(addLiquidityParams)

    // Should complete even if barrier times out
    await waitFor(
      () => {
        expect(result.current.isSuccess).toBe(true)
      },
      { timeout: 20000 }
    ) // Give enough time for timeout

    // Cache should still be invalidated
    const cachedPositions = queryClient.getQueryData(
      queryKeys.user.positions(mockAddress)
    )
    expect(cachedPositions).toBeUndefined()
  }, 30000) // Increase test timeout
})
