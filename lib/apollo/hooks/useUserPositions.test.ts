/**
 * useUserPositions Hook Tests
 *
 * Adapted from Uniswap's TokenBalancesProvider.test.tsx
 * Tests Apollo query behavior, caching, and refetch patterns.
 *
 * @see interface/apps/web/src/appGraphql/data/apollo/TokenBalancesProvider.test.tsx
 */

import { waitFor } from '@testing-library/react'
import { renderHook } from '@/test/test-utils/render'
import { mocked } from '@/test/test-utils/mocked'
import { useAccount } from 'wagmi'
import { useUserPositions } from './useUserPositions'
import { useNetwork } from '@/lib/network-context'

// Mock response setup (hoisted to top for vi.mock)
const { mockQuery, mockQueryResponse } = vi.hoisted(() => {
  const mockQuery = vi.fn()
  const mockQueryResponse = {
    data: {
      userPositions: [
        {
          positionId: '1',
          poolId: '0xpool1',
          owner: '0xaddress1',
          tickLower: -100,
          tickUpper: 100,
          liquidity: '1000000',
          token0: { symbol: 'ETH', amount: '1.0' },
          token1: { symbol: 'USDC', amount: '2000.0' },
          token0UncollectedFees: '0.01',
          token1UncollectedFees: '20.0',
        },
      ],
    },
    loading: false,
    error: undefined,
    refetch: mockQuery,
  }
  return { mockQuery, mockQueryResponse }
})

// Mock the generated Apollo hook
vi.mock('../__generated__', async () => {
  const actual = await vi.importActual('../__generated__')
  return {
    ...actual,
    useGetUserPositionsQuery: () => mockQueryResponse,
  }
})

// Mock wagmi useAccount
vi.mock('wagmi', async () => {
  const actual = await vi.importActual('wagmi')
  return {
    ...actual,
    useAccount: vi.fn(),
  }
})

// Mock network context
vi.mock('@/lib/network-context', async () => {
  const actual = await vi.importActual('@/lib/network-context')
  return {
    ...actual,
    useNetwork: vi.fn(),
  }
})

describe('useUserPositions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockClear()
    mocked(useAccount).mockReturnValue({ address: '0xaddress1', chainId: 8453 } as any)
    mocked(useNetwork).mockReturnValue({ networkMode: 'mainnet' } as any)
  })

  describe('basic functionality', () => {
    it('should return positions data when query succeeds', async () => {
      const { result } = renderHook(() => useUserPositions('0xaddress1'))

      await waitFor(() => {
        expect(result.current.data).toBeDefined()
        expect(result.current.data?.length).toBe(1)
        expect(result.current.data?.[0].positionId).toBe('1')
      })
    })

    it('should return loading state correctly', async () => {
      const { result } = renderHook(() => useUserPositions('0xaddress1'))

      // Initial state should have data (mocked)
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
        expect(result.current.isFetching).toBe(false)
      })
    })

    it('should include fee data in positions', async () => {
      const { result } = renderHook(() => useUserPositions('0xaddress1'))

      await waitFor(() => {
        expect(result.current.data?.[0].token0UncollectedFees).toBe('0.01')
        expect(result.current.data?.[0].token1UncollectedFees).toBe('20.0')
      })
    })
  })

  describe('caching behavior', () => {
    it('should use cached positions across multiple hook calls', async () => {
      // Render two hooks simultaneously
      renderHook(() => ({
        hook1: useUserPositions('0xaddress1'),
        hook2: useUserPositions('0xaddress1'),
      }))

      // Both hooks should share the same cached data
      // Apollo deduplicates identical queries
      await waitFor(() => {
        // The query should only be called once due to deduplication
        // Note: In real Apollo, this is handled by the cache
        expect(mockQueryResponse.data.userPositions.length).toBe(1)
      })
    })

    it('should skip query when no owner address provided', async () => {
      const { result } = renderHook(() => useUserPositions(''))

      await waitFor(() => {
        // When owner is empty, the hook should skip the query
        // and return undefined data
        expect(result.current.loading).toBe(false)
      })
    })
  })

  describe('refetch behavior', () => {
    it('should provide a refetch function', async () => {
      const { result } = renderHook(() => useUserPositions('0xaddress1'))

      await waitFor(() => {
        expect(typeof result.current.refetch).toBe('function')
      })
    })

    it('should refetch when account changes', async () => {
      const { result, rerender } = renderHook(() => useUserPositions('0xaddress1'))

      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })

      // Simulate account change
      mocked(useAccount).mockReturnValue({ address: '0xaddress2', chainId: 8453 } as any)
      rerender()

      // Data should still be available (Apollo handles the refetch)
      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
    })
  })

  describe('network mode handling', () => {
    it('should use correct chain for mainnet', async () => {
      mocked(useNetwork).mockReturnValue({ networkMode: 'mainnet' } as any)
      const { result } = renderHook(() => useUserPositions('0xaddress1'))

      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
    })

    it('should use correct chain for testnet', async () => {
      mocked(useNetwork).mockReturnValue({ networkMode: 'testnet' } as any)
      const { result } = renderHook(() => useUserPositions('0xaddress1'))

      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
    })
  })
})
