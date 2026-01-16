/**
 * Hook to get USD price of tokens
 * Uses on-chain V4 Quoter via batchQuotePrices
 */

import { useState, useEffect, useCallback } from 'react';
import { TokenSymbol } from '@/lib/pools-config';
import { getQuotePrice } from '@/lib/swap/quote-prices';
import useIsWindowVisible from '@/hooks/useIsWindowVisible';

const POLL_INTERVAL_MS = 30 * 1000; // Poll every 30 seconds
const CACHE_DURATION_MS = 10 * 1000; // Client cache for 10 seconds

interface PriceCache {
  price: number;
  timestamp: number;
}

const priceCache = new Map<string, PriceCache>();

export function useTokenUSDPrice(tokenSymbol: TokenSymbol | null | undefined): {
  price: number | null;
  isLoading: boolean;
} {
  const [price, setPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isWindowVisible = useIsWindowVisible();

  const fetchPrice = useCallback(async (symbol: TokenSymbol) => {
    // Check cache first
    const cached = priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      setPrice(cached.price);
      return;
    }

    setIsLoading(true);
    try {
      const quotedPrice = await getQuotePrice(symbol);
      if (quotedPrice > 0) {
        priceCache.set(symbol, { price: quotedPrice, timestamp: Date.now() });
        setPrice(quotedPrice);
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

    // Fetch immediately on mount
    fetchPrice(tokenSymbol);

    // Only poll when window is visible
    if (!isWindowVisible) {
      return;
    }

    const intervalId = setInterval(() => {
      fetchPrice(tokenSymbol);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [tokenSymbol, isWindowVisible, fetchPrice]);

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
