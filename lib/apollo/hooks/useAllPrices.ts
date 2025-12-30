/**
 * useAllPrices Hook
 *
 * Apollo hook for fetching all token prices.
 * Uses generated hook from graphql-codegen.
 *
 * @see interface/packages/api/src/clients/graphql/web/token.graphql
 */

import { usePlatformBasedFetchPolicy } from '@/hooks/usePlatformBasedFetchPolicy'
import { useNetwork } from '@/lib/network-context'
import { useGetTokenPricesQuery, type Chain } from '../__generated__'

interface TokenPricesData {
  BTC?: number
  aBTC?: number
  ETH?: number
  aETH?: number
  USDC?: number
  aUSDC?: number
  USDT?: number
  aUSDT?: number
  timestamp?: number
}

interface UseAllPricesResult {
  data: TokenPricesData | undefined
  loading: boolean
  error: boolean
  errorDetails: Error | undefined
  refetch: () => Promise<void>
}

/**
 * Hook to fetch all token prices
 *
 * @returns Token prices data with loading/error states
 *
 * @example
 * const { data: prices, loading } = useAllPrices()
 * const ethPrice = prices?.ETH
 */
export function useAllPrices(): UseAllPricesResult {
  const { networkMode } = useNetwork()
  const chain: Chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'

  // Adaptive fetch policy - reduces polling when window not visible
  const { fetchPolicy, pollInterval } = usePlatformBasedFetchPolicy({
    fetchPolicy: 'cache-and-network',
    pollInterval: 60000, // Refresh every minute
  })

  const { data, loading, error, refetch } = useGetTokenPricesQuery({
    variables: { chain },
    fetchPolicy,
    pollInterval,
  })

  return {
    data: data?.tokenPrices as TokenPricesData | undefined,
    loading: loading,
    error: !!error,
    errorDetails: error as Error | undefined,
    refetch: async () => { await refetch() },
  }
}
