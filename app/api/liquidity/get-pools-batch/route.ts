export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getPoolSubgraphId, getAllPools, getTokenDecimals } from '@/lib/pools-config';
import { batchGetTokenPrices, calculateTotalUSD } from '@/lib/price-service';
import { formatUnits } from 'viem';
import { getCacheKeyWithVersion } from '@/lib/cache-version';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// We rely on Next Data Cache via unstable_cache for caching + global tag invalidation

const GET_POOLS_TVL_BULK = `
  query GetPoolsTVL($poolIds: [String!]!) {
    pools(where: { id_in: $poolIds }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
  }
`;

const GET_POOLS_HOURLY_BULK = `
  query GetPoolsHourly($poolIds: [String!]!, $cutoff: Int!) {
    poolHourDatas(
      where: { pool_in: $poolIds, periodStartUnix_gte: $cutoff }
      orderBy: periodStartUnix
      orderDirection: desc
    ) {
      pool { id }
      periodStartUnix
      volumeToken0
      volumeToken1
    }
  }
`;

const GET_BLOCK_FOR_TS = `
  query BlockForTs($ts: Int!) {
    transactions(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_lte: $ts }) {
      timestamp
      blockNumber
    }
  }
`;

const GET_POOLS_AT_BLOCK_BULK = `
  query PoolsAtBlock($poolIds: [String!]!, $block: Int!) {
    pools(where: { id_in: $poolIds }, block: { number: $block }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
  }
`;

interface BatchPoolStatsMinimal {
  poolId: string;
  tvlUSD: number;
  tvlYesterdayUSD?: number;
  volume24hUSD: number;
  volumePrev24hUSD?: number;
}

const getSubgraphUrl = () => process.env.SUBGRAPH_URL as string | undefined;

async function computePoolsBatch(): Promise<any> {
  const SUBGRAPH_URL = getSubgraphUrl();
  if (!SUBGRAPH_URL) {
    return { success: false, message: 'SUBGRAPH_URL env var is required' };
  }

  const allPools = getAllPools();
  const targetPoolIds = allPools.map((pool) => getPoolSubgraphId(pool.id) || pool.id);

  const tokenSymbols = new Set<string>();
  for (const p of allPools) {
    tokenSymbols.add(p.currency0.symbol);
    tokenSymbols.add(p.currency1.symbol);
  }

  const tokenPrices = await batchGetTokenPrices(Array.from(tokenSymbols));

  const poolIdToConfig = new Map<string, { symbol0: string; symbol1: string; dec0: number; dec1: number }>();
  for (const p of allPools) {
    const id = (getPoolSubgraphId(p.id) || p.id).toLowerCase();
    const symbol0 = p.currency0.symbol;
    const symbol1 = p.currency1.symbol;
    poolIdToConfig.set(id, {
      symbol0,
      symbol1,
      dec0: getTokenDecimals(symbol0) || 18,
      dec1: getTokenDecimals(symbol1) || 18,
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff24h = nowSec - 24 * 60 * 60;
  const cutoff25h = nowSec - 25 * 60 * 60;
  const cutoff49h = nowSec - 49 * 60 * 60;
  const dayStart = Math.floor(nowSec / 86400) * 86400;
  const dayStartPrev = dayStart - 86400;
  const dayEndPrev = dayStartPrev + 86400 - 1;

  // TVL for all pools (tagged for cache invalidation)
  const tvlResp = await fetch(getSubgraphUrl()!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: GET_POOLS_TVL_BULK,
      variables: { poolIds: targetPoolIds.map((id) => id.toLowerCase()) },
    }),
    next: { tags: ['pools-batch'] },
  });
  const tvlJson = tvlResp.ok ? await tvlResp.json() : { data: { pools: [] } };
  const tvlById = new Map<string, { tvl0: any; tvl1: any }>();
  for (const p of tvlJson?.data?.pools || []) {
    tvlById.set(String(p.id).toLowerCase(), { tvl0: p.totalValueLockedToken0, tvl1: p.totalValueLockedToken1 });
  }

  // Hourly volume for all pools (tagged)
  const hourlyResp = await fetch(getSubgraphUrl()!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: GET_POOLS_HOURLY_BULK,
      variables: { poolIds: targetPoolIds.map((id) => id.toLowerCase()), cutoff: cutoff49h },
    }),
    next: { tags: ['pools-batch'] },
  });
  const hourlyJson = hourlyResp.ok ? await hourlyResp.json() : { data: { poolHourDatas: [] } };
  const hourlyByPoolId = new Map<string, Array<any>>();
  for (const h of hourlyJson?.data?.poolHourDatas || []) {
    const id = String(h?.pool?.id || '').toLowerCase();
    if (!id) continue;
    if (!hourlyByPoolId.has(id)) hourlyByPoolId.set(id, []);
    hourlyByPoolId.get(id)!.push(h);
  }

  // Previous-day block
  let prevDayBlock = 0;
  try {
    const blkResp = await fetch(getSubgraphUrl()!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GET_BLOCK_FOR_TS, variables: { ts: dayEndPrev } }),
      next: { tags: ['pools-batch'] },
    });
    if (blkResp.ok) {
      const blkJson = await blkResp.json();
      prevDayBlock = Number(blkJson?.data?.transactions?.[0]?.blockNumber) || 0;
    }
  } catch {}

  const prevTvlByPoolId = new Map<string, { tvl0: number; tvl1: number }>();
  if (prevDayBlock > 0) {
    try {
      const poolsAtBlockResp = await fetch(getSubgraphUrl()!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: GET_POOLS_AT_BLOCK_BULK,
          variables: { poolIds: targetPoolIds.map((id) => id.toLowerCase()), block: prevDayBlock },
        }),
        next: { tags: ['pools-batch'] },
      });
      if (poolsAtBlockResp.ok) {
        const poolsAtBlockJson = await poolsAtBlockResp.json();
        const items = poolsAtBlockJson?.data?.pools || [];
        for (const it of items) {
          const id = String(it?.id || '').toLowerCase();
          if (!id) continue;
          const tvl0 = Number(it?.totalValueLockedToken0) || 0;
          const tvl1 = Number(it?.totalValueLockedToken1) || 0;
          prevTvlByPoolId.set(id, { tvl0, tvl1 });
        }
      }
    } catch {}
  }

  const poolsStats: BatchPoolStatsMinimal[] = [];
  for (const pool of allPools) {
    try {
      const poolId = (getPoolSubgraphId(pool.id) || pool.id).toLowerCase();
      const symbol0 = pool.currency0.symbol;
      const symbol1 = pool.currency1.symbol;
      const token0Price = tokenPrices[symbol0];
      const token1Price = tokenPrices[symbol1];

      const safeToken0Price = typeof token0Price === 'number' ? token0Price : 0;
      const safeToken1Price = typeof token1Price === 'number' ? token1Price : 0;

      const cfg = poolIdToConfig.get(poolId)!;
      const tvlEntry = tvlById.get(poolId);
      let tvlUSD = 0;
      if (tvlEntry) {
        const toHuman = (val: any, decimals: number) => {
          try {
            const bi = BigInt(String(val));
            return parseFloat(formatUnits(bi, decimals));
          } catch {
            const n = parseFloat(String(val));
            return Number.isFinite(n) ? n : 0;
          }
        };
        const amt0 = toHuman(tvlEntry.tvl0 || '0', cfg.dec0);
        const amt1 = toHuman(tvlEntry.tvl1 || '0', cfg.dec1);
        tvlUSD = calculateTotalUSD(amt0, amt1, safeToken0Price, safeToken1Price);
      }

      let volume24hUSD = 0;
      let volumePrev24hUSD = 0;
      const hours = hourlyByPoolId.get(poolId) || [];
      if (hours.length > 0) {
        let sumCurr0 = 0;
        let sumPrev0 = 0;
        for (const h of hours) {
          const ts = Number(h?.periodStartUnix) || 0;
          const v0 = Number(h?.volumeToken0) || 0;
          if (ts >= cutoff24h) sumCurr0 += v0;
          else if (ts >= cutoff49h && ts < cutoff25h) sumPrev0 += v0;
        }
        volume24hUSD = sumCurr0 * safeToken0Price;
        volumePrev24hUSD = sumPrev0 * safeToken0Price;
      }

      let tvlYesterdayUSD = 0;
      const prevEntry = prevTvlByPoolId.get(poolId);
      if (prevEntry) {
        const amt0Prev = Number(prevEntry.tvl0) || 0;
        const amt1Prev = Number(prevEntry.tvl1) || 0;
        tvlYesterdayUSD = calculateTotalUSD(amt0Prev, amt1Prev, safeToken0Price, safeToken1Price);
      }

      poolsStats.push({
        poolId,
        tvlUSD,
        tvlYesterdayUSD,
        volume24hUSD,
        volumePrev24hUSD,
      });
    } catch {}
  }

  const payload = { success: true, pools: poolsStats, timestamp: Date.now() };
  return payload;
}

export async function GET() {
  try {
    const cachedCompute = unstable_cache(
      async () => {
        return await computePoolsBatch();
      },
      getCacheKeyWithVersion('pools-batch'),
      { tags: ['pools-batch'], revalidate: 3600 }
    );

    const payload = await cachedCompute();
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600' },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Unknown error' }, { status: 500 });
  }
}


