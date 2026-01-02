/**
 * Unified Token Prices API - Redis-backed with stale-while-revalidate
 *
 * Single source of truth for all token prices.
 * - Server-side: price-service.ts calls this
 * - Client-side: useTokenUSDPrice hook calls this
 * - All prices cached in Redis with 5min fresh / 15min stale window
 *
 * Price Strategy:
 * - Uses CoinGecko API for reliable market prices
 * - Testnet tokens use mainnet prices for display purposes
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis, getCachedDataWithStale, setCachedData } from '@/lib/redis';
import { priceKeys } from '@/lib/redis-keys';
import { type NetworkMode } from '@/lib/network-mode';

interface TokenPriceData {
  BTC: { usd: number; usd_24h_change?: number };
  USDC: { usd: number; usd_24h_change?: number };
  ETH: { usd: number; usd_24h_change?: number };
  USDT: { usd: number; usd_24h_change?: number };
  lastUpdated: number;
}

interface PriceResponse {
  success: boolean;
  data?: TokenPriceData & {
    // Aliases for UI compatibility (testnet tokens)
    aBTC: { usd: number };
    aUSDC: { usd: number };
    aETH: { usd: number };
    aUSDT: { usd: number };
  };
  isStale?: boolean;
  error?: string;
}


// CoinGecko ID mapping for supported tokens
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
};

interface CoinGeckoPriceData {
  usd: number;
  usd_24h_change?: number;
}

/**
 * Fetch prices and 24h changes from CoinGecko
 * Used for mainnet to get reliable market prices without liquidity depth issues
 */
async function fetchCoinGeckoPrices(): Promise<Record<string, CoinGeckoPriceData>> {
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.warn('[Prices API] CoinGecko API failed:', response.status);
      return {};
    }

    const data = await response.json();
    const prices: Record<string, CoinGeckoPriceData> = {};

    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      const priceData = data[geckoId];
      if (priceData && typeof priceData.usd === 'number') {
        prices[symbol] = {
          usd: priceData.usd,
          usd_24h_change: priceData.usd_24h_change,
        };
      }
    }

    return prices;
  } catch (error) {
    console.error('[Prices API] Error fetching from CoinGecko:', error);
    return {};
  }
}

/**
 * Fetch all prices fresh (no cache)
 *
 * Strategy:
 * - Uses CoinGecko API for reliable market prices for all networks
 * - Testnet tokens will use mainnet prices for display purposes
 */
async function fetchAllPricesFresh(): Promise<TokenPriceData> {
  const coinGeckoPrices = await fetchCoinGeckoPrices();

  return {
    BTC: coinGeckoPrices.BTC || { usd: 0 },
    USDC: coinGeckoPrices.USDC || { usd: 1, usd_24h_change: 0 },
    ETH: coinGeckoPrices.ETH || { usd: 0 },
    USDT: coinGeckoPrices.USDT || { usd: 1, usd_24h_change: 0 },
    lastUpdated: Date.now(),
  };
}

export async function GET(request: Request) {
  try {
    // Get network mode from cookies (defaults to env var for new users)
    const cookieStore = await cookies();
    const networkCookie = cookieStore.get('alphix-network-mode');
    const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    const networkMode: NetworkMode = (networkCookie?.value === 'mainnet' || networkCookie?.value === 'testnet')
      ? networkCookie.value
      : envDefault;

    // Use network-specific cache key
    const cacheKey = priceKeys.batch(networkMode);

    // Try Redis first (production)
    if (redis) {
      const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<TokenPriceData>(
        cacheKey,
        10,      // 10 seconds fresh
        30       // 30 seconds stale window
      );

      if (cachedData && !isInvalidated) {
        if (isStale) {
          // Background refresh - stale-while-revalidate pattern
          fetchAllPricesFresh()
            .then(freshData => {
              setCachedData(cacheKey, freshData, 60);
            })
            .catch(err => console.error('[Prices API] Background refresh failed:', err));
        }

        const response: PriceResponse['data'] = {
          ...cachedData,
          aBTC: cachedData.BTC,
          aUSDC: cachedData.USDC,
          aETH: cachedData.ETH,
          aUSDT: cachedData.USDT,
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

    // Production without Redis - log warning (no in-memory fallback for serverless)
    if (!redis) {
      console.warn('[Prices API] Redis unavailable - caching disabled');
    }

    // No cached data - fetch fresh
    const freshData = await fetchAllPricesFresh();

    // Store in Redis
    if (redis) {
      await setCachedData(cacheKey, freshData, 60);
    }

    const response: PriceResponse['data'] = {
      ...freshData,
      aBTC: freshData.BTC,
      aUSDC: freshData.USDC,
      aETH: freshData.ETH,
      aUSDT: freshData.USDT,
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
