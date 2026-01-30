/**
 * Unified token price hook
 *
 * Single source of truth for all client-side token USD pricing.
 * Calls /api/prices/batch -> batchQuotePrices() -> V4 Quoter + CoinGecko fallback + Redis cache.
 *
 * Replaces: useAllPrices, useTokenUSDPrice, useCoinGeckoPrice
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '@/lib/network-context';
import useIsWindowVisible from '@/hooks/useIsWindowVisible';

interface UseTokenPricesOptions {
  /** Poll interval in ms. Default: 30000 (30s). Use 60000 for informational views. */
  pollInterval?: number;
  /** Whether to enable the query. Default: true */
  enabled?: boolean;
}

interface UseTokenPricesResult {
  /** Price map: symbol -> USD price. Stablecoins = 1.0, unknown = 0 */
  prices: Record<string, number>;
  /** Whether the initial fetch is loading */
  isLoading: boolean;
  /** Error from the last fetch */
  error: Error | null;
  /** Refetch manually */
  refetch: () => Promise<void>;
}

async function fetchBatchPrices(
  symbols: string[],
  chainId: number
): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const res = await fetch('/api/prices/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols, chainId }),
  });
  if (!res.ok) throw new Error(`Batch price fetch failed: ${res.status}`);
  const data = await res.json();
  return data.prices || {};
}

/**
 * Fetch USD prices for multiple tokens with automatic polling.
 *
 * @example
 * const { prices } = useTokenPrices(['ETH', 'USDS', 'USDC']);
 * const ethPrice = prices.ETH; // 2737.54
 * const usdsPrice = prices.USDS; // 1
 */
export function useTokenPrices(
  symbols: string[],
  options: UseTokenPricesOptions = {}
): UseTokenPricesResult {
  const { pollInterval = 30_000, enabled = true } = options;
  const { chainId } = useNetwork();
  const isWindowVisible = useIsWindowVisible();

  // Stable query key: deduplicate + sort to prevent re-fetches on reorder
  const sortedSymbols = useMemo(
    () => [...new Set(symbols.filter(Boolean))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols.filter(Boolean).sort().join(',')]
  );

  const {
    data: prices = {},
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['token-prices-batch', sortedSymbols.join(','), chainId],
    queryFn: () => fetchBatchPrices(sortedSymbols, chainId),
    enabled: enabled && sortedSymbols.length > 0,
    refetchInterval: isWindowVisible ? pollInterval : false,
    staleTime: pollInterval / 2,
    gcTime: pollInterval * 5,
  });

  return {
    prices,
    isLoading,
    error: error as Error | null,
    refetch: async () => { await refetch(); },
  };
}

/**
 * Convenience: get a single token's USD price.
 * Prefer useTokenPrices([...]) when you need multiple prices.
 */
export function useTokenPrice(
  symbol: string | null | undefined,
  options: UseTokenPricesOptions = {}
): { price: number | null; isLoading: boolean } {
  const symbols = useMemo(
    () => (symbol ? [symbol] : []),
    [symbol]
  );
  const { prices, isLoading } = useTokenPrices(symbols, options);
  return {
    price: symbol && prices[symbol] > 0 ? prices[symbol] : null,
    isLoading,
  };
}

/**
 * Convenience: get USD value of a token amount.
 * Drop-in replacement for the old useTokenUSDValue.
 */
export function useTokenUSDValue(
  symbol: string | null | undefined,
  amount: string | null | undefined,
  options: UseTokenPricesOptions = {}
): { value: number | null; isLoading: boolean } {
  const { price, isLoading } = useTokenPrice(symbol, options);
  const amountNum = amount ? parseFloat(amount) : null;
  return {
    value: price !== null && amountNum !== null ? price * amountNum : null,
    isLoading,
  };
}
