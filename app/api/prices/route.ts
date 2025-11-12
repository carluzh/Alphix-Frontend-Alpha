/**
 * Unified Token Prices API - Redis-backed with stale-while-revalidate
 *
 * Single source of truth for all token prices.
 * - Server-side: price-service.ts calls this
 * - Client-side: useTokenUSDPrice hook calls this
 * - All prices cached in Redis with 5min fresh / 15min stale window
 */

import { NextRequest, NextResponse } from 'next/server';
import { redis, getCachedDataWithStale } from '@/lib/redis';
import { priceKeys } from '@/lib/redis-keys';

const QUOTE_AMOUNT_USDC = 100;
const TARGET_CHAIN_ID = 84532; // Base Sepolia

// Server-side request deduplication - prevents cache stampede
// When multiple requests arrive simultaneously, they share the same fetch operation
let ongoingFetch: Promise<TokenPriceData> | null = null;

interface TokenPriceData {
  BTC: { usd: number };
  USDC: { usd: number };
  ETH: { usd: number };
  USDT: { usd: number };
  DAI: { usd: number };
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
 * Fetch all prices fresh (no cache)
 */
async function fetchAllPricesFresh(): Promise<TokenPriceData> {
  console.log('[Prices API] Fetching all prices via quote API...');

  const [btcPrice, ethPrice, usdtPrice, daiPrice] = await Promise.all([
    getTokenUSDPriceViaQuote('aBTC'),
    getTokenUSDPriceViaQuote('aETH'),
    getTokenUSDPriceViaQuote('aUSDT'),
    getTokenUSDPriceViaQuote('aDAI'),
  ]);

  const prices: TokenPriceData = {
    BTC: { usd: btcPrice || 0 },
    USDC: { usd: 1 },
    ETH: { usd: ethPrice || 0 },
    USDT: { usd: usdtPrice || 1 },
    DAI: { usd: daiPrice || 1 },
    lastUpdated: Date.now()
  };

  console.log('[Prices API] Fetched prices:', prices);
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
    console.log('[Prices API] Deduplicating request - reusing ongoing fetch');
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

export async function GET(request: NextRequest) {
  try {
    const cacheKey = priceKeys.batch();

    // Try to get from Redis with VERY short TTL (10 seconds fresh, 30 seconds stale)
    // AMM prices change with every trade, so we need near real-time data
    const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<TokenPriceData>(
      cacheKey,
      10,      // 10 seconds fresh (very short for real-time prices)
      30       // 30 seconds stale window
    );

    // If we have fresh or stale cached data, return it immediately
    if (cachedData && !isInvalidated) {
      // If stale, trigger background refresh (don't block response)
      if (isStale) {
        console.log('[Prices API] Returning stale data (age: ~10-30s), triggering background refresh');
        fetchAllPricesWithDedup()
          .then(freshData => {
            if (redis) redis.setex(cacheKey, 60, JSON.stringify(freshData));
          })
          .catch(err => console.error('[Prices API] Background refresh failed:', err));
      }

      // Add aliases for UI compatibility
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
        headers: {
          'Cache-Control': 'no-store', // No browser caching for real-time prices
        },
      });
    }

    // No cached data - fetch fresh (with deduplication)
    console.log('[Prices API] No cached data, fetching fresh prices from AMM');
    const freshData = await fetchAllPricesWithDedup();

    // Store in Redis with short 60 second expiry (prices change with every trade)
    if (redis) {
      await redis.setex(cacheKey, 60, JSON.stringify(freshData));
    }

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
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=900',
      },
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
