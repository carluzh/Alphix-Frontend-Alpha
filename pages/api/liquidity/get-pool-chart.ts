import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Token Pair Price Chart API
 *
 * Fetches 7-day historical price data from CoinGecko for token pairs.
 * NOTE: This endpoint still uses CoinGecko for historical price data (7 days).
 * Current USD prices use the quote API (see useTokenUSDPrice hook).
 * Historical on-chain price data would require querying historical pool states.
 * Returns prices in blockchain format (token1/token0).
 * Includes 15-minute server-side caching.
 */

interface PriceDataPoint {
  timestamp: number;
  price: number;
}

interface CachedData {
  data: PriceDataPoint[];
  timestamp: number;
}

// Simple in-memory server cache
const cache = new Map<string, CachedData>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes - matches client staleTime

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { token0, token1 } = req.query;

  if (!token0 || typeof token0 !== 'string' || !token1 || typeof token1 !== 'string') {
    return res.status(400).json({ message: 'token0 and token1 are required' });
  }

  const cacheKey = `${token0}:${token1}`.toLowerCase();

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log(`[get-pool-chart] Serving cached data for ${token0}/${token1}`);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    return res.status(200).json({ data: cached.data, cached: true });
  }

  try {
    const token0CoinGeckoId = COINGECKO_IDS[token0];
    const token1CoinGeckoId = COINGECKO_IDS[token1];

    if (!token0CoinGeckoId || !token1CoinGeckoId) {
      console.warn(`[get-pool-chart] No CoinGecko ID found for ${token0} or ${token1}`);
      return res.status(200).json({
        data: [],
        message: `Token ${!token0CoinGeckoId ? token0 : token1} not supported`
      });
    }

    const isToken0Stable = STABLECOINS.includes(token0);
    const isToken1Stable = STABLECOINS.includes(token1);

    let parsedData: PriceDataPoint[];

    if (isToken0Stable && isToken1Stable) {
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

      const [result0, result1] = await Promise.all([
        response0.json(),
        response1.json()
      ]);

      const prices0 = result0.prices || [];
      const prices1 = result1.prices || [];

      // Build sorted array for nearest-timestamp lookup
      const token0Prices = prices0
        .map((p: [number, number]) => ({
          timestamp: p[0],
          price: p[1]
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      // Helper to find nearest token0 price by timestamp
      const findNearestToken0Price = (targetTimestamp: number): number => {
        if (token0Prices.length === 0) return 1;

        let nearestPrice = token0Prices[0].price;
        let minDiff = Math.abs(token0Prices[0].timestamp - targetTimestamp);

        for (const entry of token0Prices) {
          const diff = Math.abs(entry.timestamp - targetTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            nearestPrice = entry.price;
          }
          if (diff > minDiff) break; // Array is sorted, no point continuing
        }

        return nearestPrice;
      };

      parsedData = prices1.map((p: [number, number]) => {
        const timestamp = p[0];
        const token1Price: number = p[1];
        const token0Price = findNearestToken0Price(timestamp);

        return {
          timestamp: Math.floor(p[0] / 1000),
          price: token1Price / token0Price,
        };
      });
    }
    else if (isToken0Stable && !isToken1Stable) {
      const url = `https://api.coingecko.com/api/v3/coins/${token1CoinGeckoId}/market_chart?vs_currency=usd&days=7`;
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

      if (!response.ok) {
        throw new Error(`CoinGecko API returned ${response.status}`);
      }

      const result = await response.json();
      const prices = result.prices || [];

      parsedData = prices.map((p: [number, number]) => ({
        timestamp: Math.floor(p[0] / 1000),
        price: p[1],
      }));
    }
    else if (!isToken0Stable && isToken1Stable) {
      const url = `https://api.coingecko.com/api/v3/coins/${token0CoinGeckoId}/market_chart?vs_currency=usd&days=7`;
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

      if (!response.ok) {
        throw new Error(`CoinGecko API returned ${response.status}`);
      }

      const result = await response.json();
      const prices = result.prices || [];

      parsedData = prices.map((p: [number, number]) => ({
        timestamp: Math.floor(p[0] / 1000),
        price: 1 / p[1],
      }));
    }
    else {
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

      const [result0, result1] = await Promise.all([
        response0.json(),
        response1.json()
      ]);

      const prices0 = result0.prices || [];
      const prices1 = result1.prices || [];

      // Build sorted array for nearest-timestamp lookup
      const token0Prices = prices0
        .map((p: [number, number]) => ({
          timestamp: p[0],
          price: p[1]
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      // Helper to find nearest token0 price by timestamp
      const findNearestToken0Price = (targetTimestamp: number): number => {
        if (token0Prices.length === 0) return 1;

        let nearestPrice = token0Prices[0].price;
        let minDiff = Math.abs(token0Prices[0].timestamp - targetTimestamp);

        for (const entry of token0Prices) {
          const diff = Math.abs(entry.timestamp - targetTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            nearestPrice = entry.price;
          }
          if (diff > minDiff) break; // Array is sorted, no point continuing
        }

        return nearestPrice;
      };

      parsedData = prices1.map((p: [number, number]) => {
        const timestamp = p[0];
        const token1Price: number = p[1];
        const token0Price = findNearestToken0Price(timestamp);

        return {
          timestamp: Math.floor(p[0] / 1000),
          price: token1Price / token0Price,
        };
      });
    }

    parsedData.sort((a, b) => a.timestamp - b.timestamp);

    cache.set(cacheKey, {
      data: parsedData,
      timestamp: Date.now(),
    });

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    return res.status(200).json({ data: parsedData, cached: false });

  } catch (error: any) {
    console.error('[get-pool-chart] Error:', error);
    return res.status(500).json({
      message: 'Failed to fetch price chart data',
      error: error?.message || String(error)
    });
  }
}
