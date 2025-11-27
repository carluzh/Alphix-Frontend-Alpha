import type { NextApiRequest, NextApiResponse } from 'next';
import { cacheService } from '@/lib/cache/CacheService';

/**
 * Token Pair Price Chart API
 *
 * Fetches 7-day historical price data from CoinGecko for token pairs.
 * NOTE: This endpoint still uses CoinGecko for historical price data (7 days).
 * Current USD prices use the quote API (see useTokenUSDPrice hook).
 * Historical on-chain price data would require querying historical pool states.
 * Returns prices in blockchain format (token1/token0).
 * Uses Redis caching with stale-while-revalidate for optimal performance.
 */

interface PriceDataPoint {
  timestamp: number;
  price: number;
}

// Cache TTL: 15min fresh, 30min stale (shared data across all users)
const CACHE_TTL = { fresh: 900, stale: 1800 };

// CoinGecko token ID mappings
const COINGECKO_IDS: Record<string, string> = {
  'ETH': 'ethereum',
  'aETH': 'ethereum',
  'WETH': 'ethereum',
  'BTC': 'bitcoin',
  'aBTC': 'bitcoin',
  'WBTC': 'wrapped-bitcoin',
  'USDC': 'usd-coin',
  'aUSDC': 'usd-coin',
  'USDT': 'tether',
  'aUSDT': 'tether',
  'mUSDT': 'tether',
  'DAI': 'dai',
  'aDAI': 'dai',
  'YUSD': 'usd-coin', // Fallback to USDC
  'yUSDC': 'usd-coin',
};

const STABLECOINS = ['USDC', 'aUSDC', 'USDT', 'aUSDT', 'mUSDT', 'DAI', 'aDAI', 'YUSD', 'yUSDC'];

// Helper to find nearest price by timestamp
function findNearestPrice(targetTimestamp: number, prices: { timestamp: number; price: number }[]): number {
  if (prices.length === 0) return 1;

  let nearestPrice = prices[0].price;
  let minDiff = Math.abs(prices[0].timestamp - targetTimestamp);

  for (const entry of prices) {
    const diff = Math.abs(entry.timestamp - targetTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      nearestPrice = entry.price;
    }
    if (diff > minDiff) break; // Array is sorted, no point continuing
  }

  return nearestPrice;
}

// Fetch chart data from CoinGecko (extracted for caching)
async function fetchChartData(
  token0: string,
  token1: string,
  token0CoinGeckoId: string,
  token1CoinGeckoId: string
): Promise<PriceDataPoint[]> {
  const isToken0Stable = STABLECOINS.includes(token0);
  const isToken1Stable = STABLECOINS.includes(token1);

  let parsedData: PriceDataPoint[];

  if (isToken0Stable && isToken1Stable) {
    // Both stablecoins - fetch both and calculate ratio
    const [response0, response1] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/${token0CoinGeckoId}/market_chart?vs_currency=usd&days=7`, {
        headers: { 'Accept': 'application/json' }
      }),
      fetch(`https://api.coingecko.com/api/v3/coins/${token1CoinGeckoId}/market_chart?vs_currency=usd&days=7`, {
        headers: { 'Accept': 'application/json' }
      })
    ]);

    if (!response0.ok || !response1.ok) {
      throw new Error('CoinGecko API request failed');
    }

    const [result0, result1] = await Promise.all([response0.json(), response1.json()]);
    const prices0 = result0.prices || [];
    const prices1 = result1.prices || [];

    const token0Prices = prices0
      .map((p: [number, number]) => ({ timestamp: p[0], price: p[1] }))
      .sort((a: any, b: any) => a.timestamp - b.timestamp);

    parsedData = prices1.map((p: [number, number]) => ({
      timestamp: Math.floor(p[0] / 1000),
      price: p[1] / findNearestPrice(p[0], token0Prices),
    }));
  } else if (isToken0Stable && !isToken1Stable) {
    // token0 is stable - fetch token1 price in USD
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${token1CoinGeckoId}/market_chart?vs_currency=usd&days=7`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API returned ${response.status}`);
    }

    const result = await response.json();
    parsedData = (result.prices || []).map((p: [number, number]) => ({
      timestamp: Math.floor(p[0] / 1000),
      price: p[1],
    }));
  } else if (!isToken0Stable && isToken1Stable) {
    // token1 is stable - fetch token0 price and invert
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${token0CoinGeckoId}/market_chart?vs_currency=usd&days=7`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API returned ${response.status}`);
    }

    const result = await response.json();
    parsedData = (result.prices || []).map((p: [number, number]) => ({
      timestamp: Math.floor(p[0] / 1000),
      price: 1 / p[1],
    }));
  } else {
    // Both non-stable - fetch both and calculate ratio
    const [response0, response1] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/${token0CoinGeckoId}/market_chart?vs_currency=usd&days=7`, {
        headers: { 'Accept': 'application/json' }
      }),
      fetch(`https://api.coingecko.com/api/v3/coins/${token1CoinGeckoId}/market_chart?vs_currency=usd&days=7`, {
        headers: { 'Accept': 'application/json' }
      })
    ]);

    if (!response0.ok || !response1.ok) {
      throw new Error('CoinGecko API request failed');
    }

    const [result0, result1] = await Promise.all([response0.json(), response1.json()]);
    const prices0 = result0.prices || [];
    const prices1 = result1.prices || [];

    const token0Prices = prices0
      .map((p: [number, number]) => ({ timestamp: p[0], price: p[1] }))
      .sort((a: any, b: any) => a.timestamp - b.timestamp);

    parsedData = prices1.map((p: [number, number]) => ({
      timestamp: Math.floor(p[0] / 1000),
      price: p[1] / findNearestPrice(p[0], token0Prices),
    }));
  }

  parsedData.sort((a, b) => a.timestamp - b.timestamp);
  return parsedData;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { token0, token1 } = req.query;

  if (!token0 || typeof token0 !== 'string' || !token1 || typeof token1 !== 'string') {
    return res.status(400).json({ message: 'token0 and token1 are required' });
  }

  const token0CoinGeckoId = COINGECKO_IDS[token0];
  const token1CoinGeckoId = COINGECKO_IDS[token1];

  if (!token0CoinGeckoId || !token1CoinGeckoId) {
    console.warn(`[get-pool-chart] No CoinGecko ID found for ${token0} or ${token1}`);
    return res.status(200).json({
      data: [],
      message: `Token ${!token0CoinGeckoId ? token0 : token1} not supported`
    });
  }

  // Normalize token order for cache key (alphabetical) so ETH/USDC and USDC/ETH share cache
  const [sortedToken0, sortedToken1] = [token0, token1].sort((a, b) => a.localeCompare(b));
  const cacheKey = `chart:${sortedToken0.toLowerCase()}:${sortedToken1.toLowerCase()}:7d`;
  const isInverted = sortedToken0 !== token0;

  try {
    const result = await cacheService.cachedApiCall(
      cacheKey,
      CACHE_TTL,
      () => fetchChartData(sortedToken0, sortedToken1, COINGECKO_IDS[sortedToken0], COINGECKO_IDS[sortedToken1])
    );

    // If caller requested inverted order, invert the prices
    let data = result.data;
    if (isInverted && Array.isArray(data)) {
      data = data.map((p: PriceDataPoint) => ({ ...p, price: 1 / p.price }));
    }

    res.setHeader('Cache-Control', 'no-store');
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale');
    }

    return res.status(200).json({ data, cached: !result.isStale });

  } catch (error: any) {
    console.error('[get-pool-chart] Error:', error);
    return res.status(500).json({
      message: 'Failed to fetch price chart data',
      error: error?.message || String(error)
    });
  }
}
