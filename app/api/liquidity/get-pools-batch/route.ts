export const runtime = 'nodejs';
export const preferredRegion = 'auto';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getPoolSubgraphId, getAllPools, getTokenDecimals, getStateViewAddress } from '@/lib/pools-config';
import { batchGetTokenPrices, calculateTotalUSD } from '@/lib/price-service';
import { formatUnits, parseAbi } from 'viem';
import { getSubgraphUrlForPool, isDaiPool } from '@/lib/subgraph-url-helper';
import { publicClient } from '@/lib/viemClient';
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi';
import { getCachedData, setCachedData, getCachedDataWithStale } from '@/lib/redis';

// ULTRA-SIMPLIFIED: Use ONLY daily data instead of hourly (92% fewer entities fetched!)
// For 7 pools: ~21 entities (7 pools + 14 daily) vs 182 entities (7 pools + 168 hourly + 7 daily)
const GET_POOLS_COMBINED = `
  query GetPoolsSimplified($poolIds: [String!]!, $cutoffDays: Int!) {
    pools(where: { id_in: $poolIds }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
    poolDayDatas(
      first: 20
      where: { pool_in: $poolIds, date_gte: $cutoffDays }
      orderBy: date
      orderDirection: desc
    ) {
      pool { id }
      date
      volumeToken0
      volumeToken1
    }
  }
`;

interface BatchPoolStatsMinimal {
  poolId: string;
  tvlUSD: number;
  tvlYesterdayUSD?: number;
  volume24hUSD: number;
  volumePrev24hUSD?: number;
  fees24hUSD?: number;
  feesPrev24hUSD?: number;
  dynamicFeeBps?: number;
  apr24h?: number;
}

const getSubgraphUrl = () => process.env.SUBGRAPH_URL as string | undefined;
const getDaiSubgraphUrl = () => process.env.SUBGRAPH_URL_DAI as string | undefined;

// SIMPLIFIED: Direct fetch without rate limiting wrapper (Satsuma handles its own rate limits)
async function fetchSubgraphDirect(
  url: string,
  query: string,
  variables: any,
  timeoutMs: number = 20000  // 20s timeout to allow slow queries to complete
): Promise<{ success: boolean; data: any; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      cache: 'no-store', // Let Redis handle all caching
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        data: {},
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const json = await response.json();
    return { success: true, data: json };
  } catch (error) {
    clearTimeout(timeout);
    return {
      success: false,
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function computePoolsBatch(): Promise<any> {
  const SUBGRAPH_URL = getSubgraphUrl();
  const SUBGRAPH_URL_DAI = getDaiSubgraphUrl();

  if (!SUBGRAPH_URL) {
    return { success: false, message: 'SUBGRAPH_URL env var is required' };
  }

  const allPools = getAllPools();
  const targetPoolIds = allPools.map((pool) => getPoolSubgraphId(pool.id) || pool.id);

  // Separate pools into DAI and non-DAI pools
  const daiPoolIds: string[] = [];
  const nonDaiPoolIds: string[] = [];

  for (const pool of allPools) {
    const poolId = pool.id;
    const subgraphId = getPoolSubgraphId(poolId) || poolId;
    if (isDaiPool(poolId)) {
      daiPoolIds.push(subgraphId);
    } else {
      nonDaiPoolIds.push(subgraphId);
    }
  }

  const tokenSymbols = new Set<string>();
  for (const p of allPools) {
    tokenSymbols.add(p.currency0.symbol);
    tokenSymbols.add(p.currency1.symbol);
  }

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
  const dayStart = Math.floor(nowSec / 86400) * 86400;

  // IMPORTANT: Subgraph stores dates as TIMESTAMPS (seconds), not day counts
  // Convert to timestamps for matching
  const todayTimestamp = dayStart; // Today at 00:00 UTC (seconds)
  const yesterdayTimestamp = dayStart - 86400; // Yesterday at 00:00 UTC (seconds)
  const cutoffDays = Math.floor(yesterdayTimestamp / 86400); // For subgraph query (day count)

  // SIMPLIFIED: Only TVL and daily data needed
  const tvlById = new Map<string, { tvl0: any; tvl1: any }>();
  const dailyByPoolId = new Map<string, Array<any>>();
  const errors: string[] = [];
  const stateViewAddress = getStateViewAddress();

  // RUN EVERYTHING IN PARALLEL: Prices, fees, and subgraph queries have zero dependencies
  console.time('[PERF] All data fetches (parallel)');
  const [tokenPrices, feeResults, combinedResult, combinedResultDai] = await Promise.all([
    // 1. Token prices via quote API (~3-4s)
    batchGetTokenPrices(Array.from(tokenSymbols)),

    // 2. Fee multicall (~1s)
    (async () => {
      try {
        const feeCalls = targetPoolIds.map(poolId => ({
          address: stateViewAddress as `0x${string}`,
          abi: parseAbi(STATE_VIEW_ABI),
          functionName: 'getSlot0',
          args: [poolId as `0x${string}`],
        }));
        return await publicClient.multicall({
          contracts: feeCalls,
          allowFailure: true,
        });
      } catch (e) {
        console.error('[Batch] Multicall for fees failed:', e);
        return [];
      }
    })(),

    // 3. Main subgraph query (~5-6s)
    nonDaiPoolIds.length > 0
      ? fetchSubgraphDirect(SUBGRAPH_URL, GET_POOLS_COMBINED, {
          poolIds: nonDaiPoolIds.map((id) => id.toLowerCase()),
          cutoffDays,
        })
      : Promise.resolve({ success: true, data: { data: { pools: [], poolDayDatas: [] } } }),

    // 4. DAI subgraph query (~5-6s, runs parallel with #3)
    daiPoolIds.length > 0 && SUBGRAPH_URL_DAI
      ? fetchSubgraphDirect(SUBGRAPH_URL_DAI, GET_POOLS_COMBINED, {
          poolIds: daiPoolIds.map((id) => id.toLowerCase()),
          cutoffDays,
        })
      : Promise.resolve({ success: true, data: { data: { pools: [], poolDayDatas: [] } } }),
  ]);
  console.timeEnd('[PERF] All data fetches (parallel)');

  // ERROR ACCUMULATION: Track failures to distinguish from empty data
  if (!combinedResult.success && 'error' in combinedResult) {
    errors.push(`Combined query failed: ${combinedResult.error}`);
  }
  if (!combinedResultDai.success && 'error' in combinedResultDai) {
    errors.push(`Combined DAI query failed: ${combinedResultDai.error}`);
  }

  // Process TVL results
  for (const p of combinedResult.data?.data?.pools || []) {
    tvlById.set(String(p.id).toLowerCase(), { tvl0: p.totalValueLockedToken0, tvl1: p.totalValueLockedToken1 });
  }
  for (const p of combinedResultDai.data?.data?.pools || []) {
    tvlById.set(String(p.id).toLowerCase(), { tvl0: p.totalValueLockedToken0, tvl1: p.totalValueLockedToken1 });
  }

  // Process daily results (today + yesterday for volume)
  for (const d of combinedResult.data?.data?.poolDayDatas || []) {
    const id = String(d?.pool?.id || '').toLowerCase();
    if (!id) continue;
    if (!dailyByPoolId.has(id)) dailyByPoolId.set(id, []);
    dailyByPoolId.get(id)!.push(d);
  }
  for (const d of combinedResultDai.data?.data?.poolDayDatas || []) {
    const id = String(d?.pool?.id || '').toLowerCase();
    if (!id) continue;
    if (!dailyByPoolId.has(id)) dailyByPoolId.set(id, []);
    dailyByPoolId.get(id)!.push(d);
  }

  // Process fee results from multicall
  const dynamicFeesByPoolId = new Map<string, number>();
  if (Array.isArray(feeResults) && feeResults.length > 0) {
    feeResults.forEach((result, index) => {
      if (result.status === 'success') {
        const slot0 = result.result as readonly [bigint, number, number, number];
        const lpFeeRaw = Number(slot0?.[3] ?? 3000);
        // Preserve hundredths of a basis point
        const bps = Math.max(0, Math.round((((lpFeeRaw / 1_000_000) * 10_000) * 100)) / 100);
        dynamicFeesByPoolId.set(targetPoolIds[index].toLowerCase(), bps);
      }
    });
  }

  // Report errors if any occurred (but continue execution)
  if (errors.length > 0) {
    console.warn('[Batch] Subgraph errors:', errors);
  }

  // PERF OPTIMIZATION: Skip previous-day TVL query (saves ~1.4s)
  // Trade-off: TVL change % will be unavailable, but load time is critical
  const prevTvlByPoolId = new Map<string, { tvl0: number; tvl1: number }>();
  console.log('[Batch] Skipping previous-day TVL query for performance (TVL change % unavailable)');

  // NOTE: Fee multicall now runs in parallel with first batch (moved above)
  console.time('[PERF] Calculate pool stats');
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

      // SIMPLIFIED: Use daily data only (today + yesterday)
      const days = dailyByPoolId.get(poolId) || [];
      const today = days.find(d => Number(d?.date) === todayTimestamp);
      const yesterday = days.find(d => Number(d?.date) === yesterdayTimestamp);

      // Today's volume (from midnight to now) - fallback to yesterday if today has no data
      let volume24hUSD = 0;
      const volumeData = today || yesterday;
      if (volumeData) {
        const v0 = Number(volumeData?.volumeToken0) || 0;
        volume24hUSD = v0 * safeToken0Price;
      }

      // Yesterday's full day volume (or day before if yesterday is being used above)
      let volumePrev24hUSD = 0;
      const prevVolumeData = today ? yesterday : days.find(d => Number(d?.date) === yesterdayTimestamp - 86400);
      if (prevVolumeData) {
        const v0 = Number(prevVolumeData?.volumeToken0) || 0;
        volumePrev24hUSD = v0 * safeToken0Price;
      }

      let tvlYesterdayUSD = 0;
      const prevEntry = prevTvlByPoolId.get(poolId);
      if (prevEntry) {
        const amt0Prev = Number(prevEntry.tvl0) || 0;
        const amt1Prev = Number(prevEntry.tvl1) || 0;
        tvlYesterdayUSD = calculateTotalUSD(amt0Prev, amt1Prev, safeToken0Price, safeToken1Price);
      }

      // NEW: Calculate fees and 24h APY
      const dynamicFeeBps = dynamicFeesByPoolId.get(poolId) || 30; // default 0.30%
      const feeRate = dynamicFeeBps / 10_000;
      const fees24hUSD = volume24hUSD * feeRate;
      const feesPrev24hUSD = volumePrev24hUSD * feeRate;

      // 24h APY calculation
      let apr24h = 0;
      if (tvlUSD > 0 && fees24hUSD > 0) {
        const annualFees = fees24hUSD * 365;
        apr24h = (annualFees / tvlUSD) * 100;
        // Ensure finite and positive
        if (!isFinite(apr24h) || apr24h < 0) apr24h = 0;
      }

      poolsStats.push({
        poolId,
        tvlUSD,
        tvlYesterdayUSD,
        volume24hUSD,
        volumePrev24hUSD,
        fees24hUSD,
        feesPrev24hUSD,
        dynamicFeeBps,
        apr24h,
      });
    } catch {}
  }
  console.timeEnd('[PERF] Calculate pool stats');

  const payload = {
    success: true,
    pools: poolsStats,
    timestamp: Date.now(),
    errors: errors.length > 0 ? errors : undefined // Include errors for cache validation
  };

  // NOTE: Caching is now handled in GET handler to prevent caching invalid data
  return payload;
}

export async function GET(request: Request) {
  try {
    const cacheKey = 'pools-batch:v1';

    // Check cache with staleness and invalidation status
    const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<any>(
      cacheKey,
      5 * 60,   // 5 minutes fresh
      60 * 60   // 1 hour stale window
    );

    // Fresh cache: return immediately
    if (cachedData && !isStale && !isInvalidated) {
      console.log('[Batch] Redis cache HIT (fresh)');
      return NextResponse.json(cachedData);
    }

    // Invalidated cache: blocking fetch (user just did an action)
    if (cachedData && isInvalidated) {
      console.log('[Batch] Redis cache INVALIDATED - performing blocking refresh');
      const payload = await computePoolsBatch();

      const hasErrors = payload.errors && payload.errors.length > 0;
      if (payload.success && !hasErrors) {
        const cachePayload = { ...payload, errors: undefined };
        await setCachedData(cacheKey, cachePayload, 3600); // 1 hour
      }

      return NextResponse.json({ ...payload, isStale: false });
    }

    // Stale cache (not invalidated): return immediately, refresh in background
    if (cachedData && isStale) {
      console.log('[Batch] Redis cache HIT (stale) - returning stale data, triggering background refresh');

      // Trigger background revalidation (fire-and-forget)
      void computePoolsBatch()
        .then((payload) => {
          if (payload.success && !(payload.errors && payload.errors.length > 0)) {
            const cachePayload = { ...payload, errors: undefined };
            return setCachedData(cacheKey, cachePayload, 3600);
          }
        })
        .catch((error) => {
          console.error('[Batch] Background revalidation failed:', error);
        });

      // Return stale data with flag so frontend can show pulse animation
      return NextResponse.json({ ...cachedData, isStale: true });
    }

    // Cache miss: fetch fresh data
    console.log('[Batch] Redis cache MISS, fetching fresh data');
    const payload = await computePoolsBatch();

    const hasErrors = payload.errors && payload.errors.length > 0;
    if (payload.success && !hasErrors) {
      console.log('[Batch] Caching data (1-hour TTL)');
      const cachePayload = { ...payload, errors: undefined };
      await setCachedData(cacheKey, cachePayload, 3600); // 1 hour
    } else {
      console.warn('[Batch] Skipping cache - subgraph errors:', payload.errors);
    }

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('[Batch] Unexpected error:', error);
    return NextResponse.json({ success: false, message: error?.message || 'Unknown error' }, { status: 500 });
  }
}


