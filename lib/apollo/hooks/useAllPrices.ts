/**
 * useAllPrices Hook
 *
 * Apollo hook for fetching all token prices.
 * Uses generated hook from graphql-codegen.
 *
 * @see interface/packages/api/src/clients/graphql/web/token.graphql
 */

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
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  refetch: () => void
}

/**
 * Hook to fetch all token prices
 *
 * @returns Token prices data with loading/error states
 *
 * @example
 * const { data: prices, isLoading } = useAllPrices()
 * const ethPrice = prices?.ETH
 */
export function useAllPrices(): UseAllPricesResult {
  const { networkMode } = useNetwork()
  const chain: Chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'

  const { data, loading, error, refetch } = useGetTokenPricesQuery({
    variables: { chain },
    pollInterval: 60000, // Refresh every minute
    fetchPolicy: 'cache-and-network',
  })

  return {
    data: data?.tokenPrices as TokenPricesData | undefined,
    isLoading: loading,
    isError: !!error,
    error: error as Error | undefined,
    refetch: () => { refetch() },
  }
}
