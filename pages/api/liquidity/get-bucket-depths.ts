import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';

// Server-only subgraph URL (original, unswizzled)
const SUBGRAPH_ORIGINAL_URL = process.env.SUBGRAPH_ORIGINAL_URL as string;
if (!SUBGRAPH_ORIGINAL_URL) {
  throw new Error('SUBGRAPH_ORIGINAL_URL env var is required');
}

// In-memory cache (12 hours)
const TTL_MS = 12 * 60 * 60 * 1000; // 12h
const memCache = new Map<string, { ts: number; data: any }>();

function cacheKey(poolId: string, first: number) {
  return `hookpos:${poolId.toLowerCase()}:${first}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { poolId, first } = req.body ?? {};
    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ error: 'Missing poolId in body' });
    }
    // total desired items (cap for safety)
    const totalTarget = Number(first) && Number(first) > 0 ? Math.min(Number(first), 10000) : 2000;

    const apiId = getPoolSubgraphId(poolId) || poolId;
    const key = cacheKey(apiId, totalTarget);

    const forceRevalidate = String(req.headers['x-internal-revalidate'] || '').trim() === '1' || String((req.query as any)?.revalidate || '').trim() === '1';
    const cached = memCache.get(key);
    if (!forceRevalidate && cached && Date.now() - cached.ts < TTL_MS) {
      // 12h CDN cache with 12h SWR
      res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=43200');
      return res.status(200).json(cached.data);
    }

    const query = `
      query GetHookPositions($pool: Bytes!, $first: Int!, $skip: Int!) {
        hookPositions(first: $first, skip: $skip, orderBy: liquidity, orderDirection: desc, where: { pool: $pool }) {
          pool
          tickLower
          tickUpper
          liquidity
        }
      }
    `;
    // Paginate in small pages to respect subgraph limits
    const perPage = 100;
    const positions: any[] = [];
    let skip = 0;
    while (positions.length < totalTarget) {
      const pageFirst = Math.min(perPage, totalTarget - positions.length);
      const resp = await fetch(SUBGRAPH_ORIGINAL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { pool: apiId.toLowerCase(), first: pageFirst, skip } }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        return res.status(resp.status).json({ error: 'Subgraph query failed', details: txt });
      }
      const json = await resp.json();
      if (json?.errors) {
        return res.status(500).json({ error: 'Subgraph error', details: json.errors });
      }
      const pageItems = Array.isArray(json?.data?.hookPositions) ? json.data.hookPositions : [];
      positions.push(...pageItems);
      if (pageItems.length < pageFirst) break; // last page
      skip += pageItems.length;
    }

    const payload = {
      success: true,
      positions,
      totalPositions: positions.length,
      poolId: apiId,
    };

    memCache.set(key, { ts: Date.now(), data: payload });
    // 12h CDN cache with 12h SWR
    res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=43200');
    return res.status(200).json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal server error', details: err?.message || String(err) });
  }
}

