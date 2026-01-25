export const runtime = 'nodejs';
export const preferredRegion = 'auto';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api/ratelimit';
import { getPoolSubgraphId, getAllPools, getTokenDecimals, getStateViewAddress, getNetworkModeFromRequest } from '@/lib/pools-config';
import { batchQuotePrices, calculateTotalUSD } from '@/lib/swap/quote-prices';
import { formatUnits, parseAbi } from 'viem';
import { getUniswapV4SubgraphUrl, isMainnetSubgraphMode } from '@/lib/subgraph-url-helper';
import { createNetworkClient } from '@/lib/viemClient';
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi';
import { cacheService } from '@/lib/cache/CacheService';
import { poolKeys } from '@/lib/cache/redis-keys';
import type { NetworkMode } from '@/lib/network-mode';

// Combined query: pools (TVL) + poolHourDatas (24h volume) + poolDayDatas (7d yield) in single request
// Testnet version includes alphixHookTVLs for combined TVL (pool + rehypothecated)
const buildPoolsQuery = (poolCount: number, includeHookTVL: boolean) => `
  query GetPoolsWithVolume($poolIds: [String!]!, $hourCutoff: Int!, $dayCutoff: Int!) {
    pools(where: { id_in: $poolIds }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
    ${includeHookTVL ? `
    alphixHookTVLs {
      id
      pool { id }
      totalAmount0
      totalAmount1
    }
    ` : ''}
    poolHourDatas(
      first: ${Math.max(poolCount * 25, 50)}
      where: { pool_in: $poolIds, periodStartUnix_gte: $hourCutoff }
      orderBy: periodStartUnix
      orderDirection: desc
    ) {
      pool { id }
      periodStartUnix
      volumeToken0
    }
    poolDayDatas(
      first: ${Math.max(poolCount * 8, 20)}
      where: { pool_in: $poolIds, date_gte: $dayCutoff }
      orderBy: date
      orderDirection: desc
    ) {
      pool { id }
      date
      volumeToken0
    }
  }
`;

interface BatchPoolStats {
  poolId: string;
  tvlUSD: number;
  volume24hUSD: number;
  fees24hUSD: number;
  dynamicFeeBps: number;
  apr: number;
}

// Get testnet subgraph URL
const getTestnetSubgraphUrl = () => process.env.SUBGRAPH_URL as string | undefined;

async function fetchSubgraphDirect(
  url: string,
  query: string,
  variables: any,
  timeoutMs: number = 10000
): Promise<{ success: boolean; data: any; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      cache: 'no-store',
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

  const POOL_SUBGRAPH_URL = isMainnet ? getUniswapV4SubgraphUrl(networkMode) : getTestnetSubgraphUrl();

  if (!POOL_SUBGRAPH_URL) {
    return { success: false, message: isMainnet
      ? 'UNISWAP_V4_SUBGRAPH_URL env var is required for mainnet'
      : 'SUBGRAPH_URL env var is required' };
  }

  const allPools = getAllPools(networkMode);
  const targetPoolIds = allPools.map((pool) => getPoolSubgraphId(pool.id, networkMode) || pool.id);

  // All pools use the same subgraph
  const poolIds = allPools.map(pool => getPoolSubgraphId(pool.id, networkMode) || pool.id);

  const tokenSymbols = new Set<string>();
  for (const p of allPools) {
    tokenSymbols.add(p.currency0.symbol);
    tokenSymbols.add(p.currency1.symbol);
  }

  const poolIdToConfig = new Map<string, { symbol0: string; symbol1: string; dec0: number; dec1: number }>();
  for (const p of allPools) {
    const id = (getPoolSubgraphId(p.id, networkMode) || p.id).toLowerCase();
    poolIdToConfig.set(id, {
      symbol0: p.currency0.symbol,
      symbol1: p.currency1.symbol,
      dec0: getTokenDecimals(p.currency0.symbol, networkMode) || 18,
      dec1: getTokenDecimals(p.currency1.symbol, networkMode) || 18,
    });
  }

  // Cutoff timestamps
  const nowSec = Math.floor(Date.now() / 1000);
  const hourCutoff = nowSec - 86400; // 24 hours ago (for volume)
  const dayCutoff = nowSec - 7 * 86400; // 7 days ago as Unix timestamp (for yield)

  const tvlById = new Map<string, { tvl0: any; tvl1: any }>();
  const hookTvlByPoolId = new Map<string, { totalAmount0: string; totalAmount1: string }>();
  const hourlyByPoolId = new Map<string, Array<{ periodStartUnix: number; volumeToken0: string }>>();
  const dailyByPoolId = new Map<string, Array<{ date: number; volumeToken0: string }>>();
  const errors: string[] = [];
  const stateViewAddress = getStateViewAddress(networkMode);
  const client = createNetworkClient(networkMode);

  // Include alphixHookTVLs query for testnet (unified subgraph has this entity)
  const includeHookTVL = !isMainnet;

  // RUN EVERYTHING IN PARALLEL (Promise.allSettled pattern identical to Uniswap getPool.ts)
  console.time('[PERF] All data fetches (parallel)');
  const [pricesResult, feesResult, combinedQueryResult] = await Promise.allSettled([
    batchQuotePrices(Array.from(tokenSymbols), 8453, networkMode),
    (async () => {
      const feeCalls = targetPoolIds.map(poolId => ({ address: stateViewAddress as `0x${string}`, abi: parseAbi(STATE_VIEW_ABI), functionName: 'getSlot0', args: [poolId as `0x${string}`] }));
      return client.multicall({ contracts: feeCalls, allowFailure: true });
    })(),
    poolIds.length > 0 ? fetchSubgraphDirect(POOL_SUBGRAPH_URL, buildPoolsQuery(poolIds.length, includeHookTVL), { poolIds: poolIds.map(id => id.toLowerCase()), hourCutoff, dayCutoff }) : Promise.resolve({ success: true, data: { data: { pools: [], poolHourDatas: [], poolDayDatas: [], alphixHookTVLs: [] } } }),
  ]);
  console.timeEnd('[PERF] All data fetches (parallel)');

  // Extract results (Uniswap pattern: safely extract fulfilled values)
  const tokenPrices = pricesResult.status === 'fulfilled' ? pricesResult.value : {};
  const feeResults = feesResult.status === 'fulfilled' ? feesResult.value : [];
  const combinedResult = combinedQueryResult.status === 'fulfilled' ? combinedQueryResult.value : { success: false, data: {}, error: 'Query failed' };

  if (!combinedResult.success && 'error' in combinedResult) {
    errors.push(`Combined query failed: ${combinedResult.error}`);
  }

  // Process TVL results from pool entity
  for (const p of combinedResult.data?.data?.pools || []) {
    tvlById.set(String(p.id).toLowerCase(), { tvl0: p.totalValueLockedToken0, tvl1: p.totalValueLockedToken1 });
  }

  // Process combined TVL from alphixHookTVLs (testnet only - includes pool + rehypothecated amounts)
  for (const h of combinedResult.data?.data?.alphixHookTVLs || []) {
    const poolId = String(h?.pool?.id || '').toLowerCase();
    if (poolId && h.totalAmount0 && h.totalAmount1) {
      hookTvlByPoolId.set(poolId, { totalAmount0: h.totalAmount0, totalAmount1: h.totalAmount1 });
    }
  }

  // Process hourly volume data (for 24h volume)
  for (const h of combinedResult.data?.data?.poolHourDatas || []) {
    const id = String(h?.pool?.id || '').toLowerCase();
    if (!id) continue;
    if (!hourlyByPoolId.has(id)) hourlyByPoolId.set(id, []);
    hourlyByPoolId.get(id)!.push({ periodStartUnix: h.periodStartUnix, volumeToken0: h.volumeToken0 });
  }

  // Process daily volume data (for 7d yield)
  for (const d of combinedResult.data?.data?.poolDayDatas || []) {
    const id = String(d?.pool?.id || '').toLowerCase();
    if (!id) continue;
    if (!dailyByPoolId.has(id)) dailyByPoolId.set(id, []);
    dailyByPoolId.get(id)!.push({ date: d.date, volumeToken0: d.volumeToken0 });
  }

  // Process fee results from multicall
  const dynamicFeesByPoolId = new Map<string, number>();
  if (Array.isArray(feeResults) && feeResults.length > 0) {
    feeResults.forEach((result, index) => {
      if (result.status === 'success') {
        const slot0 = result.result as readonly [bigint, number, number, number];
        const lpFeeRaw = Number(slot0?.[3] ?? 3000);
        const bps = Math.max(0, Math.round((((lpFeeRaw / 1_000_000) * 10_000) * 100)) / 100);
        dynamicFeesByPoolId.set(targetPoolIds[index].toLowerCase(), bps);
      }
    });
  }

  if (errors.length > 0) {
    console.warn('[Batch] Subgraph errors:', errors);
  }

  // Calculate pool stats
  console.time('[PERF] Calculate pool stats');
  const poolsStats: BatchPoolStats[] = [];

  for (const pool of allPools) {
    try {
      const poolId = (getPoolSubgraphId(pool.id, networkMode) || pool.id).toLowerCase();
      const cfg = poolIdToConfig.get(poolId)!;
      const token0Price = tokenPrices[cfg.symbol0];
      const token1Price = tokenPrices[cfg.symbol1];

      const safeToken0Price = typeof token0Price === 'number' ? token0Price : 0;
      const safeToken1Price = typeof token1Price === 'number' ? token1Price : 0;

      // Calculate TVL - prefer combined TVL from alphixHookTVLs (pool + rehypothecated)
      let tvlUSD = 0;
      const hookTvlEntry = hookTvlByPoolId.get(poolId);
      const tvlEntry = tvlById.get(poolId);

      if (hookTvlEntry) {
        // Use combined TVL from alphixHookTVLs (already decimal-adjusted BigDecimal)
        const amt0 = parseFloat(hookTvlEntry.totalAmount0 || '0');
        const amt1 = parseFloat(hookTvlEntry.totalAmount1 || '0');
        tvlUSD = calculateTotalUSD(amt0, amt1, safeToken0Price, safeToken1Price);
      } else if (tvlEntry) {
        // Fallback to pool-only TVL (for pools without hooks or mainnet)
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

      // Calculate 24h volume from hourly data (true rolling 24h window)
      const hourlyData = hourlyByPoolId.get(poolId) || [];
      let volume24hToken0 = 0;
      for (const h of hourlyData) {
        // Double-check timestamp is within 24h (subgraph already filters, but be safe)
        if (h.periodStartUnix >= hourCutoff) {
          volume24hToken0 += Number(h.volumeToken0) || 0;
        }
      }
      const volume24hUSD = volume24hToken0 * safeToken0Price;

      // Calculate 24h fees (for display)
      const dynamicFeeBps = dynamicFeesByPoolId.get(poolId) || 30;
      const feeRate = dynamicFeeBps / 10_000;
      const fees24hUSD = volume24hUSD * feeRate;

      // Calculate 7d volume from daily data (for yield calculation)
      const dailyData = dailyByPoolId.get(poolId) || [];
      let volume7dToken0 = 0;
      for (const d of dailyData) {
        if (d.date >= dayCutoff) {
          volume7dToken0 += Number(d.volumeToken0) || 0;
        }
      }
      const volume7dUSD = volume7dToken0 * safeToken0Price;
      const fees7dUSD = volume7dUSD * feeRate;

      // APR: annualized from 7d fees (365/7 ≈ 52.14 weeks per year)
      let apr = 0;
      if (tvlUSD > 0 && fees7dUSD > 0) {
        const annualFees = fees7dUSD * (365 / 7);
        apr = (annualFees / tvlUSD) * 100;
        if (!isFinite(apr) || apr < 0) apr = 0;
      }

      poolsStats.push({
        poolId,
        tvlUSD,
        volume24hUSD,
        fees24hUSD,
        dynamicFeeBps,
        apr,
      });
    } catch {}
  }
  console.timeEnd('[PERF] Calculate pool stats');

  return {
    success: true,
    pools: poolsStats,
    timestamp: Date.now(),
    errors: errors.length > 0 ? errors : undefined
  };
}

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request)
  if (rateLimited) return rateLimited

  try {
    const requestUrl = new URL(request.url)
    const forceRefresh = requestUrl.searchParams.has('v')
    const networkParam = requestUrl.searchParams.get('network')
    const networkFromQuery = networkParam === 'mainnet' || networkParam === 'testnet' ? networkParam : null

    const cookieHeader = request.headers.get('cookie') || '';
    const networkMode = (networkFromQuery ?? getNetworkModeFromRequest(cookieHeader)) as NetworkMode;

    const cacheKey = poolKeys.batch('v3', networkMode); // v3: includes alphixHookTVLs combined TVL
    const ttl = { fresh: 5 * 60, stale: 60 * 60 }

    const shouldCache = (payload: any): boolean => {
      const hasErrors = payload?.errors && payload.errors.length > 0
      if (!payload?.success || hasErrors) return false

      const pools = payload?.pools
      if (!Array.isArray(pools) || pools.length === 0) return false
      return true
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

    const headers: HeadersInit = {}
    const isCdnCacheable = !!networkFromQuery && !forceRefresh
    headers['Cache-Control'] = isCdnCacheable
      ? 'public, s-maxage=30, stale-while-revalidate=300'
      : 'no-store'
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
