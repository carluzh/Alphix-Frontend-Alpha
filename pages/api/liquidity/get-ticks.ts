import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';

// Use Satsuma subgraph for ticks (has proper Tick entities indexed)
// Alphix-test subgraph doesn't index ticks, only hookPositions
const SATSUMA_SUBGRAPH_URL = 'https://subgraph.satsuma-prod.com/59826817594f/layanss-team--533867/marinita/api';

// In-memory cache with 5-minute TTL (ticks don't change frequently)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
type TickRow = {
  tickIdx: string;
  liquidityGross: string;
  liquidityNet: string;
  price0: string;
  price1: string;
};
type CachedTicks = {
  ts: number;
  ticks: TickRow[];
};
const tickCache = new Map<string, CachedTicks>();

function getCacheKey(poolId: string): string {
  return `ticks:${poolId.toLowerCase()}`;
}

/**
 * Fetch initialized ticks for a pool from the subgraph.
 * Ticks contain liquidityNet which represents the change in active liquidity at that tick.
 * This is the canonical way to calculate liquidity depth - much simpler and more accurate
 * than aggregating individual positions.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { poolId, first = 1000 } = req.body ?? {};

    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ error: 'Missing poolId in body' });
    }

    // Cap at 2000 ticks for safety (most pools have <100 ticks)
    const limit = Math.min(Number(first) || 1000, 2000);
    const apiId = getPoolSubgraphId(poolId) || poolId;
    const cacheKey = getCacheKey(apiId);

    // Check cache first
    const cached = tickCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.ts) < CACHE_TTL_MS) {
      console.log(`[get-ticks] Cache hit for pool ${poolId.slice(0, 10)}...`);
      return res.status(200).json({
        ticks: cached.ticks,
        cached: true,
        cacheAge: Math.floor((now - cached.ts) / 1000)
      });
    }

    console.log(`[get-ticks] Fetching ticks for pool ${poolId.slice(0, 10)}... (limit: ${limit})`);

    // Query ticks from Satsuma subgraph (has proper tick indexing)
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
          price0
          price1
        }
      }
    `;

    const response = await fetch(SATSUMA_SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: {
          pool: apiId,
          first: limit
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[get-ticks] Subgraph HTTP error: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Subgraph request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.errors) {
      console.error('[get-ticks] Subgraph GraphQL errors:', JSON.stringify(result.errors, null, 2));
      throw new Error(`Subgraph query error: ${result.errors[0]?.message || 'Unknown error'}`);
    }

    const ticks: TickRow[] = result.data?.ticks || [];

    console.log(`[get-ticks] Fetched ${ticks.length} ticks for pool ${poolId.slice(0, 10)}...`);

    // Cache the result
    tickCache.set(cacheKey, {
      ts: now,
      ticks
    });

    // Clean up old cache entries (keep last 50 pools)
    if (tickCache.size > 50) {
      const entries = Array.from(tickCache.entries());
      entries.sort((a, b) => b[1].ts - a[1].ts);
      entries.slice(50).forEach(([key]) => tickCache.delete(key));
    }

    return res.status(200).json({
      ticks,
      cached: false,
      count: ticks.length
    });

  } catch (error) {
    console.error('[get-ticks] Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch ticks',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
