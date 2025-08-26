import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getAllPools } from '@/lib/pools-config';
import { batchGetTokenPrices } from '@/lib/price-service';

// Subgraph URL (server-only)
const SUBGRAPH_URL = process.env.SUBGRAPH_URL as string;
if (!SUBGRAPH_URL) {
  throw new Error('SUBGRAPH_URL env var is required');
}

// PoolDayDatas: fetch daily token0 volume (we price in USD client-side)
const GET_POOL_DAY_VOLUMES = `
  query PoolDayVolumes($pool: String!, $first: Int!) {
    poolDayDatas(first: $first, orderBy: date, orderDirection: desc, where: { pool: $pool }) {
      date
      volumeToken0
    }
  }
`;

// Hourly rollups for today (since midnight UTC)
const GET_POOL_HOURLY_SINCE = `
  query PoolHourlySince($pool: String!, $cutoff: Int!) {
    poolHourDatas(
      where: { pool: $pool, periodStartUnix_gte: $cutoff }
      orderBy: periodStartUnix
      orderDirection: asc
    ) {
      volumeToken0
    }
  }
`;

interface ChartPointVolume {
  date: string; // YYYY-MM-DD
  volumeUSD: number;
}

interface VolumeSeries {
  poolId: string; // friendly id passed in
  data: ChartPointVolume[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VolumeSeries | { message: string; error?: any }>
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

    // Hourly cadence: cache 1h, serve stale 1h while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');

    // Resolve subgraph id and token symbols for pricing
    const allPools = getAllPools();
    const subgraphId = (getPoolSubgraphId(poolId) || poolId).toLowerCase();
    const poolCfg = allPools.find(p => (getPoolSubgraphId(p.id) || p.id).toLowerCase() === subgraphId);
    const sym0 = poolCfg?.currency0?.symbol || 'USDC';
    const prices = await batchGetTokenPrices([sym0]);
    const p0 = prices[sym0] || 1;

    // Compute date keys for the last N days excluding today (local midnight UTC)
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

    // Query poolDayDatas (we will filter out today in processing regardless)
    const resp = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GET_POOL_DAY_VOLUMES, variables: { pool: subgraphId, first: days } }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Subgraph query failed: ${body}`);
    }
    const json = await resp.json();
    const rows = Array.isArray(json?.data?.poolDayDatas) ? json.data.poolDayDatas : [];

    // Map from date key to USD volume (using token0 only, consistent with existing logic)
    const endTs = Math.floor(end.getTime() / 1000);
    const volByKey = new Map<string, number>();
    for (const r of rows) {
      const dateSec = Number(r?.date) || 0;
      if (!dateSec || dateSec >= endTs) continue; // exclude today
      const key = new Date(dateSec * 1000).toISOString().split('T')[0];
      const v0 = Math.abs(parseFloat(String(r?.volumeToken0 || '0')) || 0);
      const usd = Math.max(0, v0 * p0);
      volByKey.set(key, usd);
    }

    // Produce a continuous series; fill missing with 0
    const data: ChartPointVolume[] = allDateKeys.map((key) => ({
      date: key,
      volumeUSD: Math.max(0, volByKey.get(key) ?? 0),
    }));

    // Append today's midnight->now volume using hourly rollups (robust to subgraph tip lag)
    try {
      const todayKey = new Date().toISOString().split('T')[0];
      const dayStart = Math.floor(new Date(`${todayKey}T00:00:00Z`).getTime() / 1000);
      const hrResp = await fetch(SUBGRAPH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: GET_POOL_HOURLY_SINCE, variables: { pool: subgraphId, cutoff: dayStart } })
      });
      if (hrResp.ok) {
        const hrJson = await hrResp.json();
        const hours = Array.isArray(hrJson?.data?.poolHourDatas) ? hrJson.data.poolHourDatas : [];
        let sum0 = 0;
        for (const h of hours) sum0 += Number(h?.volumeToken0) || 0;
        const todayVolumeUSD = Math.max(0, sum0 * p0);
        data.push({ date: todayKey, volumeUSD: todayVolumeUSD });
      }
    } catch {}

    return res.status(200).json({ poolId, data });
  } catch (error: any) {
    console.error(`[chart-volume] Error:`, error);
    return res.status(500).json({ message: error?.message || 'Unexpected error', error });
  }
}


