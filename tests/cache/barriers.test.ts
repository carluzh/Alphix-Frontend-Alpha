/**
 * Tests for indexing barrier coordination
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  setIndexingBarrier,
  getIndexingBarrier,
  waitForBarrier,
  clearBarrier,
  clearAllBarriers,
  getBarrierState,
} from '@/lib/cache/coordination/barriers'

// Mock fetch for subgraph head endpoint
global.fetch = vi.fn()

describe('Indexing Barriers', () => {
  const mockAddress = '0x1234567890abcdef1234567890abcdef12345678'
  const mockBlockNumber = 1000

  beforeEach(() => {
    clearAllBarriers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    clearAllBarriers()
  })

  describe('setIndexingBarrier', () => {
    it('should create a barrier for an owner', () => {
      const barrier = setIndexingBarrier(mockAddress, mockBlockNumber)

      expect(barrier).toBeInstanceOf(Promise)
      expect(getIndexingBarrier(mockAddress)).toBe(barrier)
    })

    it('should handle case-insensitive addresses', () => {
      const barrier = setIndexingBarrier(mockAddress.toUpperCase(), mockBlockNumber)

      const retrieved = getIndexingBarrier(mockAddress.toLowerCase())
      expect(retrieved).toBe(barrier)
    })

    it('should auto-cleanup after barrier resolves', async () => {
      // Mock successful indexing
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ subgraphHead: mockBlockNumber }),
      } as Response)

      const barrier = setIndexingBarrier(mockAddress, mockBlockNumber)
      await barrier

      // Small delay for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(getIndexingBarrier(mockAddress)).toBeNull()
    })
  })

  describe('getIndexingBarrier', () => {
    it('should return null if no barrier exists', () => {
      expect(getIndexingBarrier(mockAddress)).toBeNull()
    })

    it('should return the barrier if it exists', () => {
      const barrier = setIndexingBarrier(mockAddress, mockBlockNumber)
      expect(getIndexingBarrier(mockAddress)).toBe(barrier)
    })

    it('should return null for stale barriers', async () => {
      const barrier = setIndexingBarrier(mockAddress, mockBlockNumber)

      // Fast-forward time beyond timeout
      vi.useFakeTimers()
      vi.advanceTimersByTime(25000) // 25 seconds (beyond 15s timeout + 5s grace)

      expect(getIndexingBarrier(mockAddress)).toBeNull()

      vi.useRealTimers()
    })
  })

  describe('waitForBarrier', () => {
    it('should return true if no barrier exists', async () => {
      const result = await waitForBarrier(mockAddress)
      expect(result).toBe(true)
    })

    it('should wait for barrier to resolve', async () => {
      // Mock successful indexing
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ subgraphHead: mockBlockNumber }),
      } as Response)

      setIndexingBarrier(mockAddress, mockBlockNumber)
      const result = await waitForBarrier(mockAddress)

      expect(result).toBe(true)
    })

    it('should return false if barrier times out', async () => {
      // Mock slow indexing
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ subgraphHead: mockBlockNumber - 1 }), // Not caught up yet
      } as Response)

      setIndexingBarrier(mockAddress, mockBlockNumber)

      // This will timeout after 15 seconds
      vi.useFakeTimers()
      const resultPromise = waitForBarrier(mockAddress)
      vi.advanceTimersByTime(20000) // Fast-forward 20 seconds

      const result = await resultPromise
      expect(result).toBe(false)

      vi.useRealTimers()
    }, 30000) // Increase test timeout
  })

  describe('clearBarrier', () => {
    it('should remove barrier for an owner', () => {
      setIndexingBarrier(mockAddress, mockBlockNumber)
      expect(getIndexingBarrier(mockAddress)).not.toBeNull()

      clearBarrier(mockAddress)
      expect(getIndexingBarrier(mockAddress)).toBeNull()
    })
  })

  describe('clearAllBarriers', () => {
    it('should remove all barriers', () => {
      const address1 = '0xaaaa'
      const address2 = '0xbbbb'

      setIndexingBarrier(address1, mockBlockNumber)
      setIndexingBarrier(address2, mockBlockNumber)

      expect(getIndexingBarrier(address1)).not.toBeNull()
      expect(getIndexingBarrier(address2)).not.toBeNull()

      clearAllBarriers()

      expect(getIndexingBarrier(address1)).toBeNull()
      expect(getIndexingBarrier(address2)).toBeNull()
    })
  })

  describe('getBarrierState', () => {
    it('should return empty object if no barriers', () => {
      expect(getBarrierState()).toEqual({})
    })

    it('should return state for all active barriers', () => {
      const address1 = '0xaaaa'
      const address2 = '0xbbbb'

      setIndexingBarrier(address1, mockBlockNumber)
      setIndexingBarrier(address2, mockBlockNumber)

      const state = getBarrierState()

      expect(Object.keys(state)).toHaveLength(2)
      expect(state[address1.toLowerCase()]).toBeDefined()
      expect(state[address1.toLowerCase()].timeout).toBe(15000)
      expect(state[address1.toLowerCase()].age).toBeGreaterThanOrEqual(0)
    })
  })
})
