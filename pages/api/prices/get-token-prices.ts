import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllTokenPrices } from '../../../lib/price-service';

/**
 * Token Prices API
 *
 * NOTE: In-memory caching removed - ineffective in serverless environments.
 * Caching is now handled by:
 * 1. HTTP Cache-Control headers (Vercel Edge CDN)
 * 2. Redis (Upstash) in the upstream /api/prices endpoint
 *
 * @see interface/apps/web/functions/utils/cache.ts (Uniswap uses Cloudflare edge cache)
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  try {
    // Fetch prices from upstream service (has Redis caching)
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

    // Edge cache: 60s fresh, serve stale for 5 mins while revalidating
    // This is handled by Vercel's CDN (equivalent to Uniswap's Cloudflare edge cache)
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[TokenPrices API] Error fetching prices:', error.message);

    // Return error - no in-memory fallback (serverless-safe)
    // Vercel CDN will serve stale-while-revalidate if available
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
} 