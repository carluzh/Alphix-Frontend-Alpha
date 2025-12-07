import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllTokenPrices } from '../../../lib/price-service';

// Simple in-memory server cache to hold the last successful price payload
const serverCache = new Map<string, { data: any; ts: number }>();
const CACHE_KEY = 'all-token-prices';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  try {
    // Attempt to fetch fresh prices
    const allPrices = await getAllTokenPrices();
    
    // Provide aliases expected by UI - maintain object structure for consistency
    const response = {
      BTC: allPrices.BTC,
      aBTC: allPrices.BTC,
      ETH: allPrices.ETH,
      aETH: allPrices.ETH,
      USDC: allPrices.USDC,
      aUSDC: allPrices.USDC,
      USDT: allPrices.USDT,
      aUSDT: allPrices.USDT,
      timestamp: allPrices.lastUpdated
    };

    // On success, update the cache
    serverCache.set(CACHE_KEY, { data: response, ts: Date.now() });
    
    // Edge cache hint for successful responses
    res.setHeader('Cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[TokenPrices API] Error fetching fresh prices:', error.message);
    
    // On failure, try to serve from cache
    const cached = serverCache.get(CACHE_KEY);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS * 6) { // Allow stale for up to 30 mins
      console.warn('[TokenPrices API] Serving stale prices due to fetch error.');
      res.setHeader('Cache-Control', 'no-store'); // Do not cache the stale response
      return res.status(200).json(cached.data);
    }

    // If fetch fails and cache is empty or too old, return an error
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
} 