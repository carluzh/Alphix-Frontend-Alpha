import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getNetworkModeFromRequest } from '../../../lib/pools-config';
import { getUniswapV4SubgraphUrl } from '../../../lib/subgraph-url-helper';
import { cacheService } from '@/lib/cache/CacheService';
import { poolKeys } from '@/lib/cache/redis-keys';

// Cache TTL configuration (in seconds)
const CACHE_TTL = { fresh: 300, stale: 3600 }; // 5min fresh, 1hr stale

type TickRow = {
  tickIdx: string;
  liquidityGross: string;
  liquidityNet: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie);

  try {
    const { poolId, first = 500 } = req.body ?? {};

    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ error: 'Missing poolId in body' });
    }

    const limit = Math.min(Number(first) || 500, 1000);
    const apiId = getPoolSubgraphId(poolId, networkMode) || poolId;

    // Use CacheService for tick data with stale-while-revalidate
    const result = await cacheService.cachedApiCall(
      poolKeys.ticks(apiId, networkMode),
      CACHE_TTL,
      async () => {
        const subgraphUrl = getUniswapV4SubgraphUrl(networkMode);
        const query = `
          query GetTicks($pool: Bytes!, $first: Int!) {
            ticks(
              first: $first
              where: { pool: $pool }
              orderBy: tickIdx
              orderDirection: asc
            ) {
              tickIdx
              liquidityGross
              liquidityNet
            }
          }
        `;

        // AbortController timeout pattern for subgraph fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for subgraph

        const response = await fetch(subgraphUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { pool: apiId, first: limit }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Subgraph request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.errors) {
          throw new Error(`Subgraph query error: ${data.errors[0]?.message || 'Unknown error'}`);
        }

        return (data.data?.ticks || []) as TickRow[];
      }
    );

    // Tick data is semi-static - use Uniswap multi-layer caching pattern
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale');
    }
    return res.status(200).json({
      ticks: result.data,
      cached: result.isStale ? 'stale' : true,
      count: result.data.length
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch ticks',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
