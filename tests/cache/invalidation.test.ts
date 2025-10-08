/**
 * Tests for invalidation orchestrator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { InvalidationOrchestrator } from '@/lib/cache/coordination/invalidation-orchestrator'
import { queryKeys } from '@/lib/cache/client/query-keys'

// Mock fetch
global.fetch = vi.fn()

describe('InvalidationOrchestrator', () => {
  let queryClient: QueryClient
  let orchestrator: InvalidationOrchestrator

  const mockContext = {
    owner: '0x1234',
    poolId: 'pool-1',
    positionIds: ['pos-1', 'pos-2'],
    blockNumber: 1000,
    reason: 'test',
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    orchestrator = new InvalidationOrchestrator(queryClient)
    vi.clearAllMocks()

    // Mock successful server revalidation
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ revalidated: true }),
    } as Response)
  })

  describe('invalidateAfterTransaction', () => {
    it('should invalidate user data', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await orchestrator.invalidateAfterTransaction(mockContext)

      // Should invalidate all user data
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.user.all(mockContext.owner),
      })

      // Should invalidate position IDs
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.user.positionIds(mockContext.owner),
      })
    })

    it('should invalidate position fees', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await orchestrator.invalidateAfterTransaction(mockContext)

      // Should invalidate individual position fees
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.user.fees(mockContext.owner, 'pos-1'),
      })

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.user.fees(mockContext.owner, 'pos-2'),
      })

      // Should invalidate batch fees
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.user.feesBatch(mockContext.owner, mockContext.positionIds!),
      })
    })

    it('should invalidate pool data when poolId provided', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await orchestrator.invalidateAfterTransaction(mockContext)

      // Should invalidate pool stats
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.pools.stats(mockContext.poolId!),
      })

      // Should invalidate pool state
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.pools.state(mockContext.poolId!),
      })

      // Should invalidate pool fee
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.pools.fee(mockContext.poolId!),
      })

      // Should invalidate charts
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.pools.chart(mockContext.poolId!),
      })
    })

    it('should trigger server cache revalidation', async () => {
      await orchestrator.invalidateAfterTransaction(mockContext)

      expect(fetch).toHaveBeenCalledWith(
        '/api/internal/revalidate-pools',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ targetBlock: mockContext.blockNumber }),
        })
      )
    })

    it('should not fail if server revalidation fails', async () => {
      // Mock server error
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      // Should not throw
      await expect(
        orchestrator.invalidateAfterTransaction(mockContext)
      ).resolves.not.toThrow()
    })

    it('should invalidate activity feed', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await orchestrator.invalidateAfterTransaction(mockContext)

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.user.activity(mockContext.owner),
      })
    })
  })

  describe('invalidateAllPools', () => {
    it('should invalidate all pool queries', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await orchestrator.invalidateAllPools()

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.pools.all,
      })
    })

    it('should trigger server cache revalidation', async () => {
      await orchestrator.invalidateAllPools()

      expect(fetch).toHaveBeenCalledWith(
        '/api/internal/revalidate-pools',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })

  describe('invalidatePrices', () => {
    it('should invalidate specific token prices', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const symbols = ['ETH', 'USDC']

      await orchestrator.invalidatePrices(symbols)

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.prices.token('ETH'),
      })

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.prices.token('USDC'),
      })
    })

    it('should invalidate all prices if no symbols provided', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await orchestrator.invalidatePrices()

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.prices.all,
      })
    })
  })
})
