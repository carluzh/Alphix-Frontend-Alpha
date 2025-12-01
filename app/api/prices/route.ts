/**
 * Unified Token Prices API - Redis-backed with stale-while-revalidate
 *
 * Single source of truth for all token prices.
 * - Server-side: price-service.ts calls this
 * - Client-side: useTokenUSDPrice hook calls this
 * - All prices cached in Redis with 5min fresh / 15min stale window
 */

import { NextResponse } from 'next/server';
import { redis, getCachedDataWithStale } from '@/lib/redis';
import { priceKeys } from '@/lib/redis-keys';

const QUOTE_AMOUNT_USDC = 100;
const TARGET_CHAIN_ID = 84532; // Base Sepolia

// In-memory cache fallback when Redis is unavailable (development)
let memoryCache: { data: TokenPriceData; timestamp: number } | null = null;
const MEMORY_CACHE_TTL_MS = 30 * 1000; // 30 seconds

// Server-side request deduplication - prevents cache stampede
// When multiple requests arrive simultaneously, they share the same fetch operation
let ongoingFetch: Promise<TokenPriceData> | null = null;

interface TokenPriceData {
  BTC: { usd: number; usd_24h_change?: number };
  USDC: { usd: number; usd_24h_change?: number };
  ETH: { usd: number; usd_24h_change?: number };
  USDT: { usd: number; usd_24h_change?: number };
  DAI: { usd: number; usd_24h_change?: number };
  lastUpdated: number;
}

interface PriceResponse {
  success: boolean;
  data?: TokenPriceData & {
    // Aliases for UI compatibility
    aBTC: { usd: number };
    aUSDC: { usd: number };
    aETH: { usd: number };
    aUSDT: { usd: number };
    aDAI: { usd: number };
  };
  isStale?: boolean;
  error?: string;
}

/**
 * Get USD price for a token by quoting against aUSDC
 */
async function getTokenUSDPriceViaQuote(tokenSymbol: string): Promise<number | null> {
  if (tokenSymbol === 'aUSDC') return 1;

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
                   (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const response = await fetch(`${baseUrl}/api/swap/get-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromTokenSymbol: 'aUSDC',
        toTokenSymbol: tokenSymbol,
        amountDecimalsStr: QUOTE_AMOUNT_USDC.toString(),
        swapType: 'ExactIn',
        chainId: TARGET_CHAIN_ID,
        debug: false,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.success && data.toAmount) {
      const tokenAmount = parseFloat(data.toAmount);
      return tokenAmount > 0 ? QUOTE_AMOUNT_USDC / tokenAmount : null;
    }
    return null;
  } catch (error) {
    console.error(`[Prices API] Error fetching quote for ${tokenSymbol}:`, error);
    return null;
  }
}

/**
 * Fetch 24h price change data from CoinGecko
 */
async function fetch24hPriceChanges(): Promise<Record<string, number>> {
  try {
    const coinGeckoIds = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      USDC: 'usd-coin',
      USDT: 'tether',
      DAI: 'dai'
    };

    const ids = Object.values(coinGeckoIds).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.warn('[Prices API] CoinGecko API failed:', response.status);
      return {};
    }

    const data = await response.json();
    const changes: Record<string, number> = {};

    for (const [symbol, geckoId] of Object.entries(coinGeckoIds)) {
      const priceData = data[geckoId];
      if (priceData && typeof priceData.usd_24h_change === 'number') {
        changes[symbol] = priceData.usd_24h_change;
      }
    }

    return changes;
  } catch (error) {
    console.error('[Prices API] Error fetching 24h changes from CoinGecko:', error);
    return {};
  }
}

/**
 * Fetch all prices fresh (no cache)
 */
async function fetchAllPricesFresh(): Promise<TokenPriceData> {

  // Fetch both quote prices and 24h changes in parallel
  const [quotePrices, priceChanges] = await Promise.all([
    Promise.all([
      getTokenUSDPriceViaQuote('aBTC'),
      getTokenUSDPriceViaQuote('aETH'),
      getTokenUSDPriceViaQuote('aUSDT'),
      getTokenUSDPriceViaQuote('aDAI'),
    ]),
    fetch24hPriceChanges()
  ]);

  const [btcPrice, ethPrice, usdtPrice, daiPrice] = quotePrices;

  const prices: TokenPriceData = {
    BTC: {
      usd: btcPrice || 0,
      usd_24h_change: priceChanges.BTC
    },
    USDC: {
      usd: 1,
      usd_24h_change: priceChanges.USDC || 0
    },
    ETH: {
      usd: ethPrice || 0,
      usd_24h_change: priceChanges.ETH
    },
    USDT: {
      usd: usdtPrice || 1,
      usd_24h_change: priceChanges.USDT || 0
    },
    DAI: {
      usd: daiPrice || 1,
      usd_24h_change: priceChanges.DAI || 0
    },
    lastUpdated: Date.now()
  };

  return prices;
}

/**
 * Fetch prices with request deduplication
 * If multiple requests arrive simultaneously, they all wait for and share the same fetch
 * This prevents cache stampede and reduces RPC/Redis load
 */
async function fetchAllPricesWithDedup(): Promise<TokenPriceData> {
  // If there's already an ongoing fetch, wait for it
  if (ongoingFetch) {
    return await ongoingFetch;
  }

  // Start a new fetch
  ongoingFetch = fetchAllPricesFresh()
    .finally(() => {
      // Clean up after fetch completes (success or failure)
      ongoingFetch = null;
    });

  return await ongoingFetch;
}

export async function GET() {
  try {
    const cacheKey = priceKeys.batch();

    // Try Redis first (production)
    if (redis) {
      const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<TokenPriceData>(
        cacheKey,
        10,      // 10 seconds fresh
        30       // 30 seconds stale window
      );

      if (cachedData && !isInvalidated) {
        if (isStale) {
          // Background refresh
          fetchAllPricesWithDedup()
            .then(freshData => {
              redis!.setex(cacheKey, 60, JSON.stringify(freshData));
              memoryCache = { data: freshData, timestamp: Date.now() };
            })
            .catch(err => console.error('[Prices API] Background refresh failed:', err));
        }

        const response: PriceResponse['data'] = {
          ...cachedData,
          aBTC: cachedData.BTC,
          aUSDC: cachedData.USDC,
          aETH: cachedData.ETH,
          aUSDT: cachedData.USDT,
          aDAI: cachedData.DAI,
        };

        return NextResponse.json({
          success: true,
          data: response,
          isStale: isStale,
        } as PriceResponse, {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }

    // Fallback: Check in-memory cache (for development without Redis)
    if (memoryCache && Date.now() - memoryCache.timestamp < MEMORY_CACHE_TTL_MS) {
      const response: PriceResponse['data'] = {
        ...memoryCache.data,
        aBTC: memoryCache.data.BTC,
        aUSDC: memoryCache.data.USDC,
        aETH: memoryCache.data.ETH,
        aUSDT: memoryCache.data.USDT,
        aDAI: memoryCache.data.DAI,
      };

      return NextResponse.json({
        success: true,
        data: response,
        isStale: false,
      } as PriceResponse, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // No cached data - fetch fresh (with deduplication)
    const freshData = await fetchAllPricesWithDedup();

    // Store in both Redis and memory cache
    if (redis) {
      await redis.setex(cacheKey, 60, JSON.stringify(freshData));
    }
    memoryCache = { data: freshData, timestamp: Date.now() };

    const response: PriceResponse['data'] = {
      ...freshData,
      aBTC: freshData.BTC,
      aUSDC: freshData.USDC,
      aETH: freshData.ETH,
      aUSDT: freshData.USDT,
      aDAI: freshData.DAI,
    };

    return NextResponse.json({
      success: true,
      data: response,
      isStale: false,
    } as PriceResponse, {
      headers: { 'Cache-Control': 'no-store' },
    });

  } catch (error: any) {
    console.error('[Prices API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to fetch prices',
    } as PriceResponse, {
      status: 500,
    });
  }
}
