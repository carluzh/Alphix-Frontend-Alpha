/**
 * useUncollectedFeesBatch Hook
 *
 * @deprecated Fees are now included in position data via useUserPositions.
 * Use position.token0UncollectedFees and position.token1UncollectedFees instead.
 *
 * This hook is kept for backward compatibility but simply returns empty data.
 * Migrate consumers to use useUserPositions which includes fee data.
 */

interface FeeItem {
  positionId: string
  amount0: string
  amount1: string
  totalValueUSD?: number
}

interface UseUncollectedFeesBatchResult {
  data: FeeItem[] | undefined
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  refetch: () => void
}

/**
 * @deprecated Use useUserPositions instead - fees are now included in position data.
 *
 * Hook to fetch uncollected fees for a batch of positions
 *
 * @param positionIds - Array of position IDs to fetch fees for
 * @param ttlMs - Cache time in milliseconds (default: 60000)
 * @returns Fee items with loading/error states
 *
 * @example
 * // Old approach (deprecated):
 * const { data: fees } = useUncollectedFeesBatch(['1', '2', '3'])
 *
 * // New approach:
 * const { data: positions } = useUserPositions(ownerAddress)
 * const fees = positions?.map(p => ({
 *   positionId: p.positionId,
 *   amount0: p.token0UncollectedFees,
 *   amount1: p.token1UncollectedFees,
 * }))
 */
export function useUncollectedFeesBatch(
  positionIds: string[],
  ttlMs: number = 60_000
): UseUncollectedFeesBatchResult {
  // This hook is deprecated - fees are now included in userPositions
  console.warn(
    '[useUncollectedFeesBatch] This hook is deprecated. ' +
    'Fees are now included in position data via useUserPositions.'
  )

  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: () => {},
  }
}
