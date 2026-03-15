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
import useIsWindowVisible from '@/hooks/useIsWindowVisible';
import { getStoredChainId } from '@/lib/network-mode';

interface UseTokenPricesOptions {
  /** Poll interval in ms. Default: 30000 (30s). Use 60000 for informational views. */
  pollInterval?: number;
  /** Whether to enable the query. Default: true */
  enabled?: boolean;
  /** Override chainId (derive from pool/position, not wallet context) */
  chainId?: number;
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
  const { pollInterval = 30_000, enabled = true, chainId: chainIdOverride } = options;
  // USD prices are chain-agnostic (ETH is same price on Base & Arbitrum)
  // Default to user's current chain for the quoter backend; callers can override for specificity
  const chainId = chainIdOverride ?? getStoredChainId();
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
