/**
 * Unified Token Prices API - Redis-backed with stale-while-revalidate
 *
 * Single source of truth for all token prices.
 * - Server-side: price-service.ts calls this
 * - Client-side: useTokenUSDPrice hook calls this
 * - All prices cached in Redis with 5min fresh / 15min stale window
 *
 * Price Strategy:
 * - Mainnet: Uses CoinGecko API for reliable market prices (no liquidity depth issues)
 * - Testnet: Uses quote-based prices against aUSDC (test tokens don't have CoinGecko prices)
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis, getCachedDataWithStale, setCachedData } from '@/lib/redis';
import { priceKeys } from '@/lib/redis-keys';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID, type NetworkMode } from '@/lib/network-mode';

const QUOTE_AMOUNT_USDC = 1;

// Get chain ID based on network mode
function getTargetChainId(networkMode: NetworkMode): number {
  return networkMode === 'mainnet' ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID;
}

// Get the stable token symbol based on network (aUSDC on testnet, USDC on mainnet)
function getStableTokenSymbol(networkMode: NetworkMode): string {
  return networkMode === 'mainnet' ? 'USDC' : 'aUSDC';
}

// Get token symbol for a base asset based on network mode
function getTokenSymbol(baseSymbol: string, networkMode: NetworkMode): string {
  // Mainnet uses standard symbols, testnet uses 'a' prefixed symbols
  if (networkMode === 'mainnet') {
    return baseSymbol; // BTC, ETH, USDT, USDC
  }
  // Testnet uses 'a' prefix
  return `a${baseSymbol}`; // aBTC, aETH, aUSDT, aUSDC
}

// In-memory cache fallback when Redis is unavailable (development)
// Keyed by network mode to support both mainnet and testnet
const memoryCacheByNetwork: Map<NetworkMode, { data: TokenPriceData; timestamp: number }> = new Map();
const MEMORY_CACHE_TTL_MS = 30 * 1000; // 30 seconds

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

/**
 * Get USD price for a token by quoting against stable token (USDC on mainnet, aUSDC on testnet)
 */
async function getTokenUSDPriceViaQuote(tokenSymbol: string, networkMode: NetworkMode, baseUrl: string): Promise<number | null> {
  const stableSymbol = getStableTokenSymbol(networkMode);
  if (tokenSymbol === stableSymbol) return 1;

  try {
    const response = await fetch(`${baseUrl}/api/swap/get-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromTokenSymbol: stableSymbol,
        toTokenSymbol: tokenSymbol,
        amountDecimalsStr: QUOTE_AMOUNT_USDC.toString(),
        swapType: 'ExactIn',
        chainId: getTargetChainId(networkMode),
        network: networkMode,
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

// Stablecoins should be ~$1; reject quote prices with >5% deviation (low liquidity pools)
function sanitizeStablecoinPrice(quotePrice: number | null): number {
  if (!quotePrice || quotePrice < 0.95 || quotePrice > 1.05) return 1;
  return quotePrice;
}

/**
 * Fetch all prices fresh (no cache)
 *
 * Strategy:
 * - Mainnet: Use CoinGecko API directly for reliable market prices
 *   (avoids liquidity depth issues when quoting against pools)
 * - Testnet: Use quote-based approach (test tokens don't have CoinGecko prices)
 */
async function fetchAllPricesFresh(networkMode: NetworkMode, baseUrl: string): Promise<TokenPriceData> {

  if (networkMode === 'mainnet') {
    // MAINNET: Use CoinGecko for reliable market prices
    // This avoids issues with low liquidity pools affecting price quotes
    const coinGeckoPrices = await fetchCoinGeckoPrices();

    return {
      BTC: coinGeckoPrices.BTC || { usd: 0 },
      USDC: coinGeckoPrices.USDC || { usd: 1, usd_24h_change: 0 },
      ETH: coinGeckoPrices.ETH || { usd: 0 },
      USDT: coinGeckoPrices.USDT || { usd: 1, usd_24h_change: 0 },
      lastUpdated: Date.now(),
    };
  }

  // TESTNET: Use quote-based prices (test tokens don't have CoinGecko prices)
  // Fetch both quote prices and 24h changes (for display purposes) in parallel
  const [quotePrices, coinGeckoPrices] = await Promise.all([
    Promise.all([
      getTokenUSDPriceViaQuote(getTokenSymbol('BTC', networkMode), networkMode, baseUrl),
      getTokenUSDPriceViaQuote(getTokenSymbol('ETH', networkMode), networkMode, baseUrl),
      getTokenUSDPriceViaQuote(getTokenSymbol('USDT', networkMode), networkMode, baseUrl),
    ]),
    fetchCoinGeckoPrices() // Still fetch for 24h change display
  ]);

  const [btcPrice, ethPrice, usdtPrice] = quotePrices;

  return {
    BTC: {
      usd: btcPrice || 0,
      usd_24h_change: coinGeckoPrices.BTC?.usd_24h_change,
    },
    USDC: {
      usd: 1,
      usd_24h_change: coinGeckoPrices.USDC?.usd_24h_change || 0,
    },
    ETH: {
      usd: ethPrice || 0,
      usd_24h_change: coinGeckoPrices.ETH?.usd_24h_change,
    },
    USDT: {
      usd: sanitizeStablecoinPrice(usdtPrice),
      usd_24h_change: coinGeckoPrices.USDT?.usd_24h_change || 0,
    },
    lastUpdated: Date.now(),
  };
}

// Per-network deduplication to prevent cache stampede
const ongoingFetchByNetwork: Map<NetworkMode, Promise<TokenPriceData>> = new Map();

/**
 * Fetch prices with request deduplication
 * If multiple requests arrive simultaneously, they all wait for and share the same fetch
 * This prevents cache stampede and reduces RPC/Redis load
 */
async function fetchAllPricesWithDedup(networkMode: NetworkMode, baseUrl: string): Promise<TokenPriceData> {
  // If there's already an ongoing fetch for this network, wait for it
  const existingFetch = ongoingFetchByNetwork.get(networkMode);
  if (existingFetch) {
    return await existingFetch;
  }

  // Start a new fetch for this network
  const fetchPromise = fetchAllPricesFresh(networkMode, baseUrl)
    .finally(() => {
      // Clean up after fetch completes (success or failure)
      ongoingFetchByNetwork.delete(networkMode);
    });

  ongoingFetchByNetwork.set(networkMode, fetchPromise);
  return await fetchPromise;
}

export async function GET(request: Request) {
  try {
    const baseUrl = new URL(request.url).origin;

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
          // Background refresh
          fetchAllPricesWithDedup(networkMode, baseUrl)
            .then(freshData => {
              setCachedData(cacheKey, freshData, 60);
              memoryCacheByNetwork.set(networkMode, { data: freshData, timestamp: Date.now() });
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

    // Fallback: Check in-memory cache (for development without Redis)
    const memoryCache = memoryCacheByNetwork.get(networkMode);
    if (memoryCache && Date.now() - memoryCache.timestamp < MEMORY_CACHE_TTL_MS) {
      const response: PriceResponse['data'] = {
        ...memoryCache.data,
        aBTC: memoryCache.data.BTC,
        aUSDC: memoryCache.data.USDC,
        aETH: memoryCache.data.ETH,
        aUSDT: memoryCache.data.USDT,
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
    const freshData = await fetchAllPricesWithDedup(networkMode, baseUrl);

    // Store in both Redis and memory cache
    if (redis) {
      await setCachedData(cacheKey, freshData, 60);
    }
    memoryCacheByNetwork.set(networkMode, { data: freshData, timestamp: Date.now() });

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
