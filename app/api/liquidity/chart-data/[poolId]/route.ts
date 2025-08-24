import type { NextRequest } from 'next/server';
// No pricing needed; use subgraph's USD fields

// Define the structure of the chart data points
interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  volumeUSD: number;
  tvlUSD: number; // Added back as it exists on PoolDayData via schema
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number; // Fee percentage (e.g., 0.31 for 0.31%)
}

interface PoolChartData {
  poolId: string;
  data: ChartDataPoint[];
}

// In-memory cache
const cache = new Map<string, { data: PoolChartData; timestamp: number; tailRefreshedAt?: number }>();
const TAIL_TTL_MS = 2 * 60 * 1000; // refresh today's point at most every 2 minutes

const SUBGRAPH_URL = process.env.SUBGRAPH_URL as string;

// Removed DayData/hourly queries; use Pool at end-of-day blocks only

const GET_FEE_UPDATES_QUERY = `
  query FeeUpdates($poolId: Bytes!, $cutoff: Int!) {
    alphixHooks(
      where: { pool: $poolId, timestamp_gt: $cutoff }
      orderBy: timestamp
      orderDirection: asc
      first: 50
    ) {
      id
      timestamp
      newFeeBps
    }
  }
`;

const GET_BLOCK_FOR_TS_QUERY = `
  query BlockForTs($ts: Int!) {
    transactions(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_lte: $ts }) {
      timestamp
      blockNumber
    }
  }
`;

const GET_POOL_AT_BLOCK_QUERY = `
  query PoolAtBlock($poolId: String!, $block: Int!) {
    pools(where: { id: $poolId }, block: { number: $block }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
      volumeToken0
      volumeToken1
    }
  }
`;

import { getPoolSubgraphId } from '../../../../../lib/pools-config';

// Helper to map friendly pool IDs to actual subgraph IDs
const getSubgraphPoolId = (friendlyPoolId: string): string => {
  const subgraphId = getPoolSubgraphId(friendlyPoolId);
  if (subgraphId) {
    return subgraphId.toLowerCase(); // Ensure lowercase for subgraph
  }
  
  // Fallback for legacy handling
  if (friendlyPoolId.toLowerCase() === 'aeth-ausdt') {
    return "0x4e1b037b56e13bea1dfe20e8f592b95732cc52b5b10777b9f9bea856c145e7c7";
  }
  if (friendlyPoolId.toLowerCase() === 'abtc-ausdc') {
    return "0x8392f09ccc3c387d027d189f13a1f1f2e9d73f34011191a3d58157b9b2bf8bdd";
  }
  
  // If no mapping found, assume it's already a hex ID
  return friendlyPoolId.toLowerCase(); 
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ poolId: string }> }
) {
  // Await params as required by Next.js 15+
  const { poolId: friendlyPoolId } = await context.params;

  if (!friendlyPoolId) {
    return Response.json({ message: 'poolId is required' }, { status: 400 });
  }

  const subgraphPoolId = getSubgraphPoolId(friendlyPoolId);

  // Optional days param (default 60, cap 120)
  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get('days') || '60', 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 120 ? daysParam : 60;

  // Calculate midnight UTC timestamp for today
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const midnightTodayTimestamp = Math.floor(now.getTime() / 1000);

  // Check cache using friendlyPoolId + days as the cache key
  const cacheKey = `${friendlyPoolId}:${days}`;
  const cachedEntry = cache.get(cacheKey);
  if (cachedEntry && (Math.floor(cachedEntry.timestamp / 1000) >= midnightTodayTimestamp)) {
    // Live-tail refresh for today's point
    try {
      const todayKey = new Date().toISOString().split('T')[0];
      const hasToday = Array.isArray(cachedEntry.data?.data) && cachedEntry.data.data.some(d => d.date === todayKey);
      const shouldRefreshTail = hasToday && (!cachedEntry.tailRefreshedAt || (Date.now() - cachedEntry.tailRefreshedAt) > TAIL_TTL_MS);
      if (shouldRefreshTail) {
        const nowSec = Math.floor(Date.now() / 1000);
        const dayStartToday = Math.floor(new Date(todayKey + 'T00:00:00Z').getTime() / 1000);
        const prevDayEnd = dayStartToday - 1; // end of yesterday

        // Fetch prices and pool config
        const { getPoolSubgraphId, getAllPools } = await import('../../../../../lib/pools-config');
        const { batchGetTokenPrices } = await import('../../../../../lib/price-service');
        const all = getAllPools();
        const poolCfg = all.find(p => (getPoolSubgraphId(p.id) || p.id).toLowerCase() === subgraphPoolId.toLowerCase());
        const sym0 = poolCfg?.currency0?.symbol || 'USDC';
        const sym1 = poolCfg?.currency1?.symbol || 'USDC';
        const prices = await batchGetTokenPrices([sym0, sym1]);
        const p0 = prices[sym0] || 1;
        const p1 = prices[sym1] || 1;

        // Blocks for now and yesterday end
        const [blkNowResp, blkPrevResp] = await Promise.all([
          fetch(SUBGRAPH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GET_BLOCK_FOR_TS_QUERY, variables: { ts: nowSec } }) }),
          fetch(SUBGRAPH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GET_BLOCK_FOR_TS_QUERY, variables: { ts: prevDayEnd } }) }),
        ]);
        let updatedPoint: ChartDataPoint | null = null;
        if (blkNowResp.ok && blkPrevResp.ok) {
          const blkNowJson = await blkNowResp.json();
          const blkPrevJson = await blkPrevResp.json();
          const blockNow = Number(blkNowJson?.data?.transactions?.[0]?.blockNumber) || 0;
          const blockPrev = Number(blkPrevJson?.data?.transactions?.[0]?.blockNumber) || 0;
          if (blockNow) {
            const [poolNowResp, poolPrevResp] = await Promise.all([
              fetch(SUBGRAPH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GET_POOL_AT_BLOCK_QUERY, variables: { poolId: subgraphPoolId, block: blockNow } }) }),
              blockPrev ? fetch(SUBGRAPH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GET_POOL_AT_BLOCK_QUERY, variables: { poolId: subgraphPoolId, block: blockPrev } }) }) : Promise.resolve(null as any),
            ]);
            if (poolNowResp?.ok) {
              const nowJson = await poolNowResp.json();
              const nowPool = nowJson?.data?.pools?.[0];
              const tvl0 = Number(nowPool?.totalValueLockedToken0) || 0;
              const tvl1 = Number(nowPool?.totalValueLockedToken1) || 0;
              const tvlUSD = tvl0 * p0 + tvl1 * p1;
              const cum0Now = Number(nowPool?.volumeToken0) || 0;
              let cum0Prev = 0;
              if (blockPrev && poolPrevResp && (poolPrevResp as Response).ok) {
                const prevJson = await (poolPrevResp as Response).json();
                const prevPool = prevJson?.data?.pools?.[0];
                cum0Prev = Number(prevPool?.volumeToken0) || 0;
              }
              const d0 = Math.max(0, cum0Now - cum0Prev);
              const volumeUSD = d0 * p0;
              const volumeTvlRatio = tvlUSD > 0 ? volumeUSD / tvlUSD : 0;
              // dynamicFee unchanged here; keep cached value
              const existing = cachedEntry.data.data.find(d => d.date === todayKey);
              updatedPoint = {
                date: todayKey,
                volumeUSD,
                tvlUSD: Number.isFinite(tvlUSD) && tvlUSD > 0 ? tvlUSD : (existing?.tvlUSD || 0),
                volumeTvlRatio,
                emaRatio: existing?.emaRatio ?? volumeTvlRatio, // preserve mapped "target ratio" field from historical endpoint if merged later
                dynamicFee: existing?.dynamicFee ?? 0,
              };
            }
          }
        }
        if (updatedPoint) {
          const nextData = cachedEntry.data.data.map(d => (d.date === todayKey ? updatedPoint! : d));
          cachedEntry.data = { ...cachedEntry.data, data: nextData };
          cachedEntry.tailRefreshedAt = Date.now();
          cache.set(cacheKey, cachedEntry);
        }
      }
    } catch (e) {
      console.warn('[API Cache HIT] Tail refresh failed; serving cached data', e);
    }
    console.log(`[API Cache HIT] Returning cached chart data for pool: ${friendlyPoolId} days=${days}`);
    return Response.json(cache.get(cacheKey)!.data);
  }
  console.log(`[API Cache MISS or STALE] Fetching chart data for pool: ${friendlyPoolId} days=${days} (using subgraph ID: ${subgraphPoolId})`);

  try {
    // Build time window: last N days from now (midnight UTC)
    const nowSec = Math.floor(Date.now() / 1000);
    const fromDay = Math.floor((nowSec - days * 24 * 60 * 60) / 86400) * 86400;

    // Continuous daily series from fromDay..yesterday
    const start = new Date(fromDay * 1000);
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const processedChartData: ChartDataPoint[] = [];
    let cursor = new Date(start);
    // token prices for USD conversion
    try {
      const { getPoolSubgraphId, getAllPools } = await import('../../../../../lib/pools-config');
      const { batchGetTokenPrices } = await import('../../../../../lib/price-service');
      const all = getAllPools();
      const poolCfg = all.find(p => (getPoolSubgraphId(p.id) || p.id).toLowerCase() === subgraphPoolId.toLowerCase());
      const sym0 = poolCfg?.currency0?.symbol || 'USDC';
      const sym1 = poolCfg?.currency1?.symbol || 'USDC';
      const prices = await batchGetTokenPrices([sym0, sym1]);
      const p0 = prices[sym0] || 1;
      const p1 = prices[sym1] || 1;
      // track previous cumulative volumeToken0 to compute daily deltas (token0 only)
      let prevVol0: number | null = null;
      // carry-forward TVL to avoid holes when a day's snapshot is missing
      let lastTvlUSD: number | null = null;
      while (cursor <= end) {
        const key = cursor.toISOString().split('T')[0];
        const dayEnd = Math.floor(new Date(key + 'T23:59:59Z').getTime() / 1000);
        // 1) block <= dayEnd
        const blkResp = await fetch(SUBGRAPH_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_BLOCK_FOR_TS_QUERY, variables: { ts: dayEnd } })
        });
        let volumeUSD = 0;
        let tvlUSD = 0;
        if (blkResp.ok) {
          const blkJson = await blkResp.json();
          const blockNum = Number(blkJson?.data?.transactions?.[0]?.blockNumber) || 0;
          if (blockNum) {
            // 2) pool at block
            const poolResp = await fetch(SUBGRAPH_URL, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: GET_POOL_AT_BLOCK_QUERY, variables: { poolId: subgraphPoolId, block: blockNum } })
            });
            if (poolResp.ok) {
              const poolJson = await poolResp.json();
              const poolData = poolJson?.data?.pools?.[0];
              if (poolData) {
                const tvl0 = Number(poolData.totalValueLockedToken0) || 0;
                const tvl1 = Number(poolData.totalValueLockedToken1) || 0;
                tvlUSD = tvl0 * p0 + tvl1 * p1;
                const cum0 = Number(poolData.volumeToken0) || 0;
                if (prevVol0 !== null) {
                  const d0 = Math.max(0, cum0 - prevVol0);
                  // Use only token0 volume valued in USD
                  volumeUSD = d0 * p0;
                }
                prevVol0 = cum0;
              }
            }
          }
        }
        // If we failed to read a snapshot for the day, carry forward the last known TVL
        if ((!Number.isFinite(tvlUSD) || tvlUSD <= 0) && lastTvlUSD !== null && lastTvlUSD > 0) {
          tvlUSD = lastTvlUSD;
        }
        const volumeTvlRatio = tvlUSD > 0 ? volumeUSD / tvlUSD : 0;
        processedChartData.push({ date: key, volumeUSD, tvlUSD, volumeTvlRatio, emaRatio: volumeTvlRatio, dynamicFee: 0.3 });
        // update carry-forward state
        if (Number.isFinite(tvlUSD) && tvlUSD > 0) {
          lastTvlUSD = tvlUSD;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    } catch {}

    // EMA (period 10)
    for (let i = 1; i < processedChartData.length; i++) {
      const current = processedChartData[i];
      const prev = processedChartData[i - 1];
      const k = 2 / (10 + 1);
      current.emaRatio = current.volumeTvlRatio * k + prev.emaRatio * (1 - k);
    }

    // Map dynamicFee from on-chain hook updates (alphixHooks)
    if (processedChartData.length > 0) {
      const firstDay = processedChartData[0].date;
      const cutoff = Math.floor(new Date(firstDay + 'T00:00:00Z').getTime() / 1000);
      try {
        const hooksResp = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_FEE_UPDATES_QUERY, variables: { poolId: subgraphPoolId, cutoff } })
        });
        if (hooksResp.ok) {
          const hooksJson = await hooksResp.json();
          const hooks = (hooksJson?.data?.alphixHooks || [])
            .map((h: any) => ({ ts: Number(h?.timestamp) || 0, bps: Number(h?.newFeeBps) || 0 }))
            .filter((h: any) => h.ts > 0)
            .sort((a: any, b: any) => a.ts - b.ts);

          let idx = 0;
          let currentFeePercent = processedChartData[0].dynamicFee; // default stays if no hooks
          for (let i = 0; i < processedChartData.length; i++) {
            const dayStart = Math.floor(new Date(processedChartData[i].date + 'T00:00:00Z').getTime() / 1000);
            const dayEnd = dayStart + 86400 - 1;
            while (idx < hooks.length && hooks[idx].ts <= dayEnd) {
              const bps = hooks[idx].bps;
              // Convert bps to percent units expected by UI: 2612 -> 0.2612 (percent)
              currentFeePercent = bps / 10000;
              idx++;
            }
            processedChartData[i].dynamicFee = currentFeePercent;
          }
        }
      } catch (e) {
        console.warn('[chart-data] fee updates fetch failed; leaving default dynamicFee', e);
      }
    }

    const result: PoolChartData = {
      poolId: friendlyPoolId, // Return data associated with the friendly ID
      data: processedChartData,
    };

    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    console.log(`[API Cache SET] Cached chart data for pool: ${friendlyPoolId} days=${days}`);

    return Response.json(result);

  } catch (error) {
    console.error(`Error fetching chart data for pool ${friendlyPoolId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return Response.json({ message: `Failed to fetch chart data: ${errorMessage}` }, { status: 500 });
  }
}

// Helper to ensure correct Next.js 13+ API route behavior (optional but good practice)
export const dynamic = 'force-dynamic'; // Ensures the route is re-evaluated on each request (if not cached) 