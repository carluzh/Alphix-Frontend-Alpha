export const runtime = 'nodejs';
export const preferredRegion = 'auto';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getPoolSubgraphId, getAllPools, getTokenDecimals, getStateViewAddress, getNetworkModeFromRequest } from '@/lib/pools-config';
import { batchGetTokenPrices, calculateTotalUSD } from '@/lib/price-service';
import { formatUnits, parseAbi } from 'viem';
import { getUniswapV4SubgraphUrl, isDaiPool, isMainnetSubgraphMode } from '@/lib/subgraph-url-helper';
import { createNetworkClient } from '@/lib/viemClient';
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi';
import { cacheService } from '@/lib/cache/CacheService';
import { poolKeys } from '@/lib/redis-keys';
import type { NetworkMode } from '@/lib/network-mode';

// Fetch 7 days of daily data for accurate APR calculation
// Dynamic limit: poolCount * 10 (7 days + buffer per pool)
const buildPoolsQuery = (poolCount: number) => `
  query GetPoolsSimplified($poolIds: [String!]!, $cutoffDays: Int!) {
    pools(where: { id_in: $poolIds }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
    poolDayDatas(
      first: ${Math.max(poolCount * 10, 20)}
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
  volume7dUSD: number;
  volumeAvgDailyUSD?: number;
  fees7dUSD?: number;
  feesAvgDailyUSD?: number;
  dynamicFeeBps?: number;
  apr7d?: number;
  daysWithData?: number;
}

// Get testnet subgraph URLs (used only on testnet)
const getTestnetSubgraphUrl = () => process.env.SUBGRAPH_URL as string | undefined;
const getTestnetDaiSubgraphUrl = () => process.env.SUBGRAPH_URL_DAI as string | undefined;

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

async function computePoolsBatch(networkMode: NetworkMode): Promise<any> {
  const isMainnet = isMainnetSubgraphMode(networkMode);

  // Get the appropriate subgraph URL(s)
  // Mainnet: Use Uniswap v4 subgraph for Pool/PoolDayData
  // Testnet: Use our full subgraph (with DAI pool separation)
  const POOL_SUBGRAPH_URL = isMainnet ? getUniswapV4SubgraphUrl(networkMode) : getTestnetSubgraphUrl();
  const TESTNET_DAI_URL = !isMainnet ? getTestnetDaiSubgraphUrl() : undefined;

  if (!POOL_SUBGRAPH_URL) {
    return { success: false, message: isMainnet
      ? 'UNISWAP_V4_SUBGRAPH_URL env var is required for mainnet'
      : 'SUBGRAPH_URL env var is required' };
  }

  const allPools = getAllPools(networkMode);
  const targetPoolIds = allPools.map((pool) => getPoolSubgraphId(pool.id, networkMode) || pool.id);

  // Separate pools into DAI and non-DAI pools (testnet only)
  // Mainnet: all pools go to single Uniswap v4 subgraph
  const daiPoolIds: string[] = [];
  const nonDaiPoolIds: string[] = [];

  for (const pool of allPools) {
    const poolId = pool.id;
    const subgraphId = getPoolSubgraphId(poolId, networkMode) || poolId;
    if (!isMainnet && isDaiPool(poolId, networkMode)) {
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
    const id = (getPoolSubgraphId(p.id, networkMode) || p.id).toLowerCase();
    const symbol0 = p.currency0.symbol;
    const symbol1 = p.currency1.symbol;
    poolIdToConfig.set(id, {
      symbol0,
      symbol1,
      dec0: getTokenDecimals(symbol0, networkMode) || 18,
      dec1: getTokenDecimals(symbol1, networkMode) || 18,
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(nowSec / 86400) * 86400;

  // IMPORTANT: Subgraph stores dates as TIMESTAMPS (seconds), not day counts
  // Fetch 7 days of data for stable APR calculation
  const todayTimestamp = dayStart; // Today at 00:00 UTC (seconds)
  const sevenDaysAgoTimestamp = dayStart - (7 * 86400); // 7 days ago at 00:00 UTC
  const cutoffDays = Math.floor(sevenDaysAgoTimestamp / 86400); // For subgraph query (day count)

  // SIMPLIFIED: Only TVL and daily data needed
  const tvlById = new Map<string, { tvl0: any; tvl1: any }>();
  const dailyByPoolId = new Map<string, Array<any>>();
  const errors: string[] = [];
  const stateViewAddress = getStateViewAddress(networkMode);
  const client = createNetworkClient(networkMode);

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
        return await client.multicall({
          contracts: feeCalls,
          allowFailure: true,
        });
      } catch (e) {
        console.error('[Batch] Multicall for fees failed:', e);
        return [];
      }
    })(),

    // 3. Main subgraph query (~5-6s) - dynamic limit based on pool count
    // Mainnet: queries Uniswap v4 subgraph
    // Testnet: queries our full subgraph (non-DAI pools)
    nonDaiPoolIds.length > 0
      ? fetchSubgraphDirect(POOL_SUBGRAPH_URL, buildPoolsQuery(nonDaiPoolIds.length), {
          poolIds: nonDaiPoolIds.map((id) => id.toLowerCase()),
          cutoffDays,
        })
      : Promise.resolve({ success: true, data: { data: { pools: [], poolDayDatas: [] } } }),

    // 4. DAI subgraph query (testnet only, runs parallel with #3)
    // Mainnet: skip (no DAI pool separation)
    daiPoolIds.length > 0 && TESTNET_DAI_URL
      ? fetchSubgraphDirect(TESTNET_DAI_URL, buildPoolsQuery(daiPoolIds.length), {
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

  // NOTE: Fee multicall now runs in parallel with first batch (moved above)
  console.time('[PERF] Calculate pool stats');
  const poolsStats: BatchPoolStatsMinimal[] = [];
  for (const pool of allPools) {
    try {
      const poolId = (getPoolSubgraphId(pool.id, networkMode) || pool.id).toLowerCase();
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

      // Aggregate 7 days of volume data for stable APR
      const allDays = dailyByPoolId.get(poolId) || [];
      // Filter to last 7 days (excluding today which may be incomplete)
      const last7Days = allDays.filter(d => {
        const date = Number(d?.date);
        return date >= sevenDaysAgoTimestamp && date < todayTimestamp;
      });

      // Calculate 7-day volume total
      let volume7dToken0 = 0;
      for (const day of last7Days) {
        volume7dToken0 += Number(day?.volumeToken0) || 0;
      }
      const volume7dUSD = volume7dToken0 * safeToken0Price;
      const daysWithData = last7Days.length || 1; // Avoid division by zero
      const volumeAvgDailyUSD = volume7dUSD / daysWithData;

      let tvlYesterdayUSD = 0;
      const prevEntry = prevTvlByPoolId.get(poolId);
      if (prevEntry) {
        const amt0Prev = Number(prevEntry.tvl0) || 0;
        const amt1Prev = Number(prevEntry.tvl1) || 0;
        tvlYesterdayUSD = calculateTotalUSD(amt0Prev, amt1Prev, safeToken0Price, safeToken1Price);
      }

      // Calculate 7-day fees and APR
      const dynamicFeeBps = dynamicFeesByPoolId.get(poolId) || 30; // default 0.30%
      const feeRate = dynamicFeeBps / 10_000;
      const fees7dUSD = volume7dUSD * feeRate;
      const feesAvgDailyUSD = fees7dUSD / daysWithData;

      // 7-day APR calculation (annualized from daily average)
      let apr7d = 0;
      if (tvlUSD > 0 && feesAvgDailyUSD > 0) {
        const annualFees = feesAvgDailyUSD * 365;
        apr7d = (annualFees / tvlUSD) * 100;
        if (!isFinite(apr7d) || apr7d < 0) apr7d = 0;
      }

      poolsStats.push({
        poolId,
        tvlUSD,
        tvlYesterdayUSD,
        volume7dUSD,
        volumeAvgDailyUSD,
        fees7dUSD,
        feesAvgDailyUSD,
        dynamicFeeBps,
        apr7d,
        daysWithData,
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
    const requestUrl = new URL(request.url)
    const forceRefresh = requestUrl.searchParams.has('v')
    const networkParam = requestUrl.searchParams.get('network')
    const networkFromQuery = networkParam === 'mainnet' || networkParam === 'testnet' ? networkParam : null

    // Get network mode from cookies (App Router pattern)
    const cookieHeader = request.headers.get('cookie') || '';
    const networkMode = (networkFromQuery ?? getNetworkModeFromRequest(cookieHeader)) as NetworkMode;

    // Network mode now selected via ?network= or cookies (for legacy callers)

    // Cache key includes network mode to separate mainnet and testnet data
    const cacheKey = poolKeys.batch('v1', networkMode);
    const ttl = { fresh: 5 * 60, stale: 60 * 60 } // 5min fresh, 1hr stale

    const shouldCache = (payload: any): boolean => {
      const hasErrors = payload?.errors && payload.errors.length > 0
      if (!payload?.success || hasErrors) return false

      // Guard against caching obviously bogus "all zeros" snapshots
      const pools = payload?.pools
      if (!Array.isArray(pools) || pools.length === 0) return false
      const looksAllZero = pools.every((p: any) =>
        Number(p?.tvlUSD ?? 0) === 0 &&
        Number(p?.volume7dUSD ?? 0) === 0 &&
        Number(p?.fees7dUSD ?? 0) === 0
      )
      return !looksAllZero
    }

    let result: { data: any; isStale: boolean }
    if (forceRefresh) {
      const payload = await computePoolsBatch(networkMode)
      const cacheable = shouldCache(payload)
      if (!cacheable) {
        console.warn('[Batch] Forced refresh: skipping cache write (invalid payload)')
      } else {
        await cacheService.set(cacheKey, { ...payload, errors: undefined }, ttl.stale)
      }
      result = { data: { ...payload, errors: undefined }, isStale: false }
    } else {
      const cached = await cacheService.cachedApiCall(
        cacheKey,
        ttl,
        async () => {
          const payload = await computePoolsBatch(networkMode)
          return { ...payload, errors: undefined }
        },
        { shouldCache }
      )
      result = cached
    }

    // Set cache headers for consistency with other endpoints
    const headers: HeadersInit = {}
    const isCdnCacheable = !!networkFromQuery && !forceRefresh
    headers['Cache-Control'] = isCdnCacheable
      ? 'public, s-maxage=30, stale-while-revalidate=300'
      : 'no-store' // prevent cookie-variant caching; forceRefresh should never be cached
    headers['X-Network-Mode'] = networkMode
    if (result.isStale) {
      headers['X-Cache-Status'] = 'stale';
    }

    return NextResponse.json({ ...result.data, isStale: result.isStale }, { headers });
  } catch (error: any) {
    console.error('[Batch] Unexpected error:', error);
    return NextResponse.json({ success: false, message: error?.message || 'Unknown error' }, { status: 500 });
  }
}


