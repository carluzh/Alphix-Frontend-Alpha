import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getAllPools } from '@/lib/pools-config';
import { batchGetTokenPrices } from '@/lib/price-service';
import { getSubgraphUrlForPool } from '@/lib/subgraph-url-helper';

// Default Subgraph URL (server-only)
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

// Simple in-memory server cache (per instance)
const serverCache = new Map<string, { data: any; ts: number }>();
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// Tiny access hook for internal revalidation
// eslint-disable-next-line @typescript-eslint/naming-convention
export function __getServerCache() { return serverCache; }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VolumeSeries | { message: string; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  let fallbackCacheKey = '';

  try {
    const { poolId, days: daysQuery, v: versionQuery } = req.query as { poolId?: string; days?: string; v?: string };
    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
    }
    const rawDays = parseInt(daysQuery || '60', 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 && rawDays <= 120 ? rawDays : 60;

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');

    const bust = typeof (req.query?.bust as string | undefined) === 'string';
    const version = versionQuery || '';
    const subgraphId = (getPoolSubgraphId(poolId) || poolId).toLowerCase();
    const cacheKey = `${subgraphId}|${days}`;
    fallbackCacheKey = cacheKey;

    // Support both version-based and timestamp-based cache busting
    const shouldBypassCache = bust || (version && version !== 'default');
    if (!shouldBypassCache) {
      const cached = serverCache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < SIX_HOURS_MS) {
        return res.status(200).json(cached.data);
      }
    }

    const allPools = getAllPools();
    const poolCfg = allPools.find(p => (getPoolSubgraphId(p.id) || p.id).toLowerCase() === subgraphId);
    const sym0 = poolCfg?.currency0?.symbol || 'USDC';
    const p0 = (await batchGetTokenPrices([sym0]))[sym0] || 1;

    const end = new Date();
    end.setUTCHours(0, 0, 0, 0); // Midnight UTC of today
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days);
    const allDateKeys: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) { // Include today
      allDateKeys.push(cursor.toISOString().split('T')[0]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const cutoff = Math.floor(start.getTime() / 1000);
    const query = `{
      poolHourDatas(
        where: { pool: "${subgraphId}", periodStartUnix_gte: ${cutoff} }
        orderBy: periodStartUnix
        orderDirection: desc
        first: 1000
      ) {
        periodStartUnix
        volumeToken0
      }
    }`;

    // Use the appropriate subgraph URL for this pool
    const subgraphUrl = getSubgraphUrlForPool(poolId);
    const hourlyResp = await fetch(subgraphUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
    });
    if (!hourlyResp.ok) {
      const body = await hourlyResp.text();
      throw new Error(`hourly query failed: ${body}`);
    }
    const hourlyJson = await hourlyResp.json();
    const hourlyData = hourlyJson?.data?.poolHourDatas || [];

    const volByDate = new Map<string, number>();
    // Note: Data comes in descending order (newest first) due to query optimization
    for (const h of hourlyData) {
      const date = new Date(h.periodStartUnix * 1000).toISOString().split('T')[0];
      const vol = (volByDate.get(date) || 0) + Number(h.volumeToken0);
      volByDate.set(date, vol);
    }

    const data: ChartPointVolume[] = allDateKeys.map(key => ({
      date: key,
      volumeUSD: (volByDate.get(key) || 0) * p0,
    }));

    const payload = { poolId, data };
    try { serverCache.set(cacheKey, { data: payload, ts: Date.now() }); } catch {}
    return res.status(200).json(payload);
  } catch (error: any) {
    console.error(`[chart-volume] Error:`, error);
    try {
      if (fallbackCacheKey) {
        const cached = serverCache.get(fallbackCacheKey);
        if (cached) {
          console.log(`[chart-volume] Serving stale cache for ${fallbackCacheKey} due to error.`);
          res.setHeader('Cache-Control', 'no-store');
          return res.status(200).json(cached.data);
        }
      }
    } catch {}
    return res.status(500).json({ message: error?.message || 'Unexpected error', error });
  }
}


