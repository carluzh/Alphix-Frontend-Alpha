import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';
import { getSubgraphUrlForPool } from '../../../lib/subgraph-url-helper';
import { cacheService } from '@/lib/cache/CacheService';
import { poolKeys } from '@/lib/redis-keys';

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

  try {
    const { poolId, first = 500 } = req.body ?? {};

    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ error: 'Missing poolId in body' });
    }

    const limit = Math.min(Number(first) || 500, 1000);
    const apiId = getPoolSubgraphId(poolId) || poolId;

    // Use CacheService for tick data with stale-while-revalidate
    const result = await cacheService.cachedApiCall(
      poolKeys.ticks(apiId),
      CACHE_TTL,
      async () => {
        const subgraphUrl = getSubgraphUrlForPool(poolId);
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

        const response = await fetch(subgraphUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { pool: apiId, first: limit }
          })
        });

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

    res.setHeader('Cache-Control', 'no-store'); // Prevent browser/CDN caching
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
