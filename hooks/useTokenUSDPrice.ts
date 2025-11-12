/**
 * Hook to get USD price of tokens
 * Unified client hook - calls centralized /api/prices endpoint
 * Continuous polling for real-time AMM price updates
 */

import { useState, useEffect, useCallback } from 'react';
import { TokenSymbol } from '@/lib/pools-config';

const POLL_INTERVAL_MS = 15 * 1000; // Poll every 15 seconds for real-time prices
const CACHE_DURATION_MS = 10 * 1000; // Client cache for 10 seconds (very short)

interface AllPricesResponse {
  success: boolean;
  data?: {
    BTC: { usd: number };
    USDC: { usd: number };
    ETH: { usd: number };
    USDT: { usd: number };
    DAI: { usd: number };
    aBTC: { usd: number };
    aUSDC: { usd: number };
    aETH: { usd: number };
    aUSDT: { usd: number };
    aDAI: { usd: number };
    lastUpdated: number;
  };
  isStale?: boolean;
}

interface PriceCache {
  prices: AllPricesResponse['data'];
  timestamp: number;
}

// Single cache for all prices (fetched together)
let allPricesCache: PriceCache | null = null;
let ongoingFetch: Promise<AllPricesResponse> | null = null;

/**
 * Fetch all prices from centralized API (deduplicates requests)
 */
async function fetchAllPrices(): Promise<AllPricesResponse> {
  // If there's an ongoing fetch, wait for it
  if (ongoingFetch) {
    return ongoingFetch;
  }

  ongoingFetch = (async () => {
    try {
      const response = await fetch('/api/prices', {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch prices');
      }

      const data: AllPricesResponse = await response.json();

      // Update cache
      if (data.success && data.data) {
        allPricesCache = {
          prices: data.data,
          timestamp: Date.now(),
        };
      }

      return data;
    } finally {
      ongoingFetch = null;
    }
  })();

  return ongoingFetch;
}

/**
 * Map token symbol to price key in response
 */
function getPriceKey(symbol: TokenSymbol): keyof AllPricesResponse['data'] {
  // Handle both base and "a" prefixed symbols
  if (symbol.startsWith('a')) {
    return symbol as keyof AllPricesResponse['data'];
  }
  return `a${symbol}` as keyof AllPricesResponse['data'];
}

export function useTokenUSDPrice(tokenSymbol: TokenSymbol | null | undefined): {
  price: number | null;
  isLoading: boolean;
} {
  const [price, setPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPrice = useCallback(async (symbol: TokenSymbol) => {
    // Check cache first
    if (allPricesCache && Date.now() - allPricesCache.timestamp < CACHE_DURATION_MS) {
      const priceKey = getPriceKey(symbol);
      const priceData = allPricesCache.prices?.[priceKey];
      if (priceData && 'usd' in priceData) {
        setPrice(priceData.usd);
        return;
      }
    }

    setIsLoading(true);
    try {
      const response = await fetchAllPrices();

      if (response.success && response.data) {
        const priceKey = getPriceKey(symbol);
        const priceData = response.data[priceKey];
        if (priceData && 'usd' in priceData) {
          setPrice(priceData.usd);
        } else {
          setPrice(null);
        }
      } else {
        setPrice(null);
      }
    } catch (error) {
      console.error(`[useTokenUSDPrice] Error fetching price for ${symbol}:`, error);
      setPrice(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tokenSymbol) {
      setPrice(null);
      setIsLoading(false);
      return;
    }

    // Skip if token is aUSDC itself
    if (tokenSymbol === 'aUSDC') {
      setPrice(1);
      setIsLoading(false);
      return;
    }

    // Fetch immediately on mount
    fetchPrice(tokenSymbol);

    // Set up polling for real-time price updates (AMM prices change with every trade)
    const intervalId = setInterval(() => {
      fetchPrice(tokenSymbol);
    }, POLL_INTERVAL_MS);

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenSymbol]); // Only depend on tokenSymbol, fetchPrice is stable

  return { price, isLoading };
}

/**
 * Hook to get USD value of a token amount
 */
export function useTokenUSDValue(
  tokenSymbol: TokenSymbol | null | undefined,
  amount: string | null | undefined
): {
  value: number | null;
  isLoading: boolean;
} {
  const { price, isLoading } = useTokenUSDPrice(tokenSymbol);
  const amountNum = amount ? parseFloat(amount) : null;

  return {
    value: price !== null && amountNum !== null ? price * amountNum : null,
    isLoading,
  };
}

