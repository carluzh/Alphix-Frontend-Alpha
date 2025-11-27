import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';
import { getSubgraphUrlForPool } from '../../../lib/subgraph-url-helper';

const CACHE_TTL_MS = 5 * 60 * 1000;
type TickRow = {
  tickIdx: string;
  liquidityGross: string;
  liquidityNet: string;
};
type CachedTicks = {
  ts: number;
  ticks: TickRow[];
};
const tickCache = new Map<string, CachedTicks>();

function getCacheKey(poolId: string): string {
  return `ticks:${poolId.toLowerCase()}`;
}

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
    const cacheKey = getCacheKey(apiId);
    const cached = tickCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.ts) < CACHE_TTL_MS) {
      return res.status(200).json({
        ticks: cached.ticks,
        cached: true,
        cacheAge: Math.floor((now - cached.ts) / 1000)
      });
    }

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

    const result = await response.json();

    if (result.errors) {
      throw new Error(`Subgraph query error: ${result.errors[0]?.message || 'Unknown error'}`);
    }

    const ticks: TickRow[] = result.data?.ticks || [];

    tickCache.set(cacheKey, { ts: now, ticks });

    if (tickCache.size > 50) {
      const entries = Array.from(tickCache.entries());
      entries.sort((a, b) => b[1].ts - a[1].ts);
      entries.slice(50).forEach(([key]) => tickCache.delete(key));
    }

    return res.status(200).json({ ticks, cached: false, count: ticks.length });

  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch ticks',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
