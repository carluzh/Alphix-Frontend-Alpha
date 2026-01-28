/**
 * Hook to get USD prices from CoinGecko API
 * Used for external market price comparison against pool prices
 */

import { useState, useEffect, useCallback } from 'react';
import useIsWindowVisible from '@/hooks/useIsWindowVisible';

const POLL_INTERVAL_MS = 60 * 1000; // Poll every 60 seconds (CoinGecko rate limits)
const CACHE_DURATION_MS = 30 * 1000; // Client cache for 30 seconds

// CoinGecko token ID mapping
// Matches existing mapping in pages/api/liquidity/pool-price-history.ts
export const COINGECKO_IDS: Record<string, string> = {
  'ETH': 'ethereum',
  'atETH': 'ethereum',
  'aETH': 'ethereum',
  'WETH': 'weth',
  'BTC': 'bitcoin',
  'aBTC': 'bitcoin',
  'WBTC': 'wrapped-bitcoin',
  'USDC': 'usd-coin',
  'atUSDC': 'usd-coin',
  'aUSDC': 'usd-coin',
  'USDT': 'tether',
  'atDAI': 'dai',
  'DAI': 'dai',
};

// Stablecoins always return $1.00
const STABLECOINS = new Set(['USDC', 'USDT', 'atUSDC', 'atDAI', 'aUSDC', 'DAI']);

interface PriceCache {
  price: number;
  timestamp: number;
}

const priceCache = new Map<string, PriceCache>();

interface CoinGeckoPriceResult {
  price: number | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch price from CoinGecko API
 */
async function fetchCoinGeckoPrice(tokenSymbol: string): Promise<number | null> {
  // Stablecoins always $1.00
  if (STABLECOINS.has(tokenSymbol)) {
    return 1.0;
  }

  const coinId = COINGECKO_IDS[tokenSymbol];
  if (!coinId) {
    console.warn(`[useCoinGeckoPrice] No CoinGecko ID for ${tokenSymbol}`);
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[useCoinGeckoPrice] CoinGecko returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data[coinId]?.usd ?? null;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.warn('[useCoinGeckoPrice] Request timeout');
    } else {
      console.warn('[useCoinGeckoPrice] Error:', error);
    }
    return null;
  }
}

/**
 * Batch fetch prices for multiple tokens
 */
async function fetchCoinGeckoPrices(
  tokenSymbols: string[]
): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  const toFetch: string[] = [];

  // Handle stablecoins and collect non-stablecoins to fetch
  for (const symbol of tokenSymbols) {
    if (STABLECOINS.has(symbol)) {
      result[symbol] = 1.0;
    } else {
      const coinId = COINGECKO_IDS[symbol];
      if (coinId) {
        toFetch.push(symbol);
      } else {
        result[symbol] = null;
      }
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  // Batch fetch
  const coinIds = toFetch.map(s => COINGECKO_IDS[s]).join(',');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd`,
      {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Return nulls for all
      toFetch.forEach(s => { result[s] = null; });
      return result;
    }

    const data = await response.json();

    for (const symbol of toFetch) {
      const coinId = COINGECKO_IDS[symbol];
      result[symbol] = data[coinId]?.usd ?? null;
    }

    return result;
  } catch (error) {
    console.warn('[useCoinGeckoPrice] Batch fetch error:', error);
    toFetch.forEach(s => { result[s] = null; });
    return result;
  }
}

/**
 * Hook to get CoinGecko USD price for a single token
 */
export function useCoinGeckoPrice(tokenSymbol: string | null | undefined): CoinGeckoPriceResult {
  const [price, setPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isWindowVisible = useIsWindowVisible();

  const fetchPrice = useCallback(async (symbol: string) => {
    const cacheKey = symbol;

    // Check cache first
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      setPrice(cached.price);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const fetchedPrice = await fetchCoinGeckoPrice(symbol);
      if (fetchedPrice !== null) {
        priceCache.set(cacheKey, { price: fetchedPrice, timestamp: Date.now() });
        setPrice(fetchedPrice);
      } else {
        setPrice(null);
      }
    } catch (err) {
      setError(err as Error);
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

  return { price, isLoading, error };
}

/**
 * Hook to get CoinGecko USD prices for multiple tokens
 * More efficient than multiple useCoinGeckoPrice calls
 */
export function useCoinGeckoPrices(tokenSymbols: string[]): {
  prices: Record<string, number | null>;
  isLoading: boolean;
  error: Error | null;
} {
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isWindowVisible = useIsWindowVisible();
  const symbolsKey = tokenSymbols.sort().join(',');

  const fetchPrices = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) {
      setPrices({});
      return;
    }

    // Check if all are cached
    const now = Date.now();
    const allCached = symbols.every(s => {
      const cached = priceCache.get(s);
      return cached && now - cached.timestamp < CACHE_DURATION_MS;
    });

    if (allCached) {
      const cachedPrices: Record<string, number | null> = {};
      symbols.forEach(s => {
        cachedPrices[s] = priceCache.get(s)?.price ?? null;
      });
      setPrices(cachedPrices);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const fetchedPrices = await fetchCoinGeckoPrices(symbols);

      // Update cache
      for (const [symbol, price] of Object.entries(fetchedPrices)) {
        if (price !== null) {
          priceCache.set(symbol, { price, timestamp: Date.now() });
        }
      }

      setPrices(fetchedPrices);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokenSymbols.length === 0) {
      setPrices({});
      setIsLoading(false);
      return;
    }

    // Fetch immediately
    fetchPrices(tokenSymbols);

    // Only poll when visible
    if (!isWindowVisible) {
      return;
    }

    const intervalId = setInterval(() => {
      fetchPrices(tokenSymbols);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [symbolsKey, isWindowVisible, fetchPrices]);

  return { prices, isLoading, error };
}

/**
 * Calculate market price ratio from two token USD prices
 * Returns token0Price in terms of token1 (how many token1 for 1 token0)
 */
export function calculateMarketPriceRatio(
  token0USDPrice: number | null,
  token1USDPrice: number | null
): number | null {
  if (token0USDPrice === null || token1USDPrice === null) {
    return null;
  }
  if (token1USDPrice === 0) {
    return null;
  }
  // Market price = token0USD / token1USD
  // This gives "how many token1 for 1 token0"
  return token0USDPrice / token1USDPrice;
}
