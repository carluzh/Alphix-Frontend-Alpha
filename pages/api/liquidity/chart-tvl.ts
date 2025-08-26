import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getAllPools } from '@/lib/pools-config';
import { batchGetTokenPrices } from '@/lib/price-service';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL as string;
if (!SUBGRAPH_URL) {
  throw new Error('SUBGRAPH_URL env var is required');
}

// We fetch one block per day (end-of-day) and snapshot the pool TVL there.
// Use GraphQL aliases to compress HTTP calls to two requests max.

interface ChartPointTvl { date: string; tvlUSD: number }
interface TvlSeries { poolId: string; data: ChartPointTvl[] }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TvlSeries | { message: string; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  try {
    const { poolId, days: daysQuery } = req.query as { poolId?: string; days?: string };
    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
    }
    const rawDays = parseInt(daysQuery || '60', 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 && rawDays <= 120 ? rawDays : 60;

    // Daily cadence: cache 1 day, serve stale 1 day while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');

    // Resolve subgraph id and pricing
    const allPools = getAllPools();
    const subgraphId = (getPoolSubgraphId(poolId) || poolId).toLowerCase();
    const poolCfg = allPools.find(p => (getPoolSubgraphId(p.id) || p.id).toLowerCase() === subgraphId);
    const sym0 = poolCfg?.currency0?.symbol || 'USDC';
    const sym1 = poolCfg?.currency1?.symbol || 'USDC';
    const prices = await batchGetTokenPrices([sym0, sym1]);
    const p0 = prices[sym0] || 1;
    const p1 = prices[sym1] || 1;

    // Date keys last N days excluding today
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0); // midnight today
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days);
    const allDateKeys: string[] = [];
    const cursor = new Date(start);
    while (cursor < end) {
      allDateKeys.push(cursor.toISOString().split('T')[0]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // Build blocks alias query for end-of-day (23:59:59Z)
    const blockAliases = allDateKeys.map((key) => {
      const alias = `b_${key.replace(/-/g, '_')}`;
      const ts = Math.floor(new Date(key + 'T23:59:59Z').getTime() / 1000);
      return `${alias}: transactions(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_lte: ${ts} }) { blockNumber }`;
    }).join('\n');
    const blocksQuery = `query Blocks {\n${blockAliases}\n}`;

    const blkResp = await fetch(SUBGRAPH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: blocksQuery })
    });
    if (!blkResp.ok) {
      const body = await blkResp.text();
      throw new Error(`blocks query failed: ${body}`);
    }
    const blocksJson = await blkResp.json();
    const aliasToBlock = new Map<string, number>();
    for (const key of allDateKeys) {
      const alias = `b_${key.replace(/-/g, '_')}`;
      const arr = blocksJson?.data?.[alias] || [];
      const block = Array.isArray(arr) && arr.length > 0 ? Number(arr[0]?.blockNumber) || 0 : 0;
      aliasToBlock.set(key, block);
    }

    // Build pools alias query at each block
    const poolAliases = allDateKeys.map((key) => {
      const alias = `p_${key.replace(/-/g, '_')}`;
      const block = aliasToBlock.get(key) || 0;
      if (!block) return `${alias}: pools(where: { id: "${subgraphId}" }) { id }`;
      return `${alias}: pools(where: { id: "${subgraphId}" }, block: { number: ${block} }) { totalValueLockedToken0 totalValueLockedToken1 }`;
    }).join('\n');
    const poolsQuery = `query Pools {\n${poolAliases}\n}`;

    const poolsResp = await fetch(SUBGRAPH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: poolsQuery })
    });
    if (!poolsResp.ok) {
      const body = await poolsResp.text();
      throw new Error(`pools-at-block query failed: ${body}`);
    }
    const poolsJson = await poolsResp.json();

    // Produce continuous tvl series with forward-fill of zeros
    const data: ChartPointTvl[] = [];
    let last = 0;
    for (const key of allDateKeys) {
      const alias = `p_${key.replace(/-/g, '_')}`;
      const arr = poolsJson?.data?.[alias] || [];
      const tvl0 = Array.isArray(arr) && arr[0] ? Number(arr[0]?.totalValueLockedToken0) || 0 : 0;
      const tvl1 = Array.isArray(arr) && arr[0] ? Number(arr[0]?.totalValueLockedToken1) || 0 : 0;
      const tvlUSD = tvl0 * p0 + tvl1 * p1;
      const val = tvlUSD > 0 ? tvlUSD : last;
      data.push({ date: key, tvlUSD: val });
      if (val > 0) last = val;
    }

    // Note: do not append today's point here; it's added client-side from get-pools-batch

    return res.status(200).json({ poolId, data });
  } catch (error: any) {
    console.error(`[chart-tvl] Error:`, error);
    return res.status(500).json({ message: error?.message || 'Unexpected error', error });
  }
}


