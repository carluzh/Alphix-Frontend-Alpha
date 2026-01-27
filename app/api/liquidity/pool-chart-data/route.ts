export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkRateLimit } from '@/lib/api/ratelimit';
import { getPoolSubgraphId, getAllPools, type NetworkMode } from '@/lib/pools-config';
import { getUniswapV4SubgraphUrl } from '@/lib/subgraph-url-helper';
import { setCachedData, getCachedDataWithStale } from '@/lib/cache/redis';
import { poolKeys } from '@/lib/cache/redis-keys';
import { batchQuotePrices, calculateTotalUSD } from '@/lib/swap/quote-prices';

interface ChartDataPoint {
  date: string;
  tvlUSD: number;
  volumeUSD: number;
  feesUSD: number;
}

interface DynamicFeeEvent {
  timestamp: string;
  newFeeBps?: string;
  currentRatio?: string;      // Current Vol/TVL activity measurement (volatile)
  newTargetRatio?: string;    // New EMA target after this update (smooth)
  oldTargetRatio?: string;    // Previous EMA target before this update
}

interface ChartDataResponse {
  success: boolean;
  poolId: string;
  data: ChartDataPoint[];
  feeEvents: DynamicFeeEvent[];
  timestamp?: number;
  isStale?: boolean;
}

async function computeChartData(poolId: string, days: number, networkMode: NetworkMode, baseUrl: string): Promise<ChartDataResponse> {
  try {
    const subgraphId = (getPoolSubgraphId(poolId, networkMode) || poolId).toLowerCase();
    if (!/^0x[a-f0-9]+$/i.test(subgraphId)) throw new Error('Invalid pool ID format');

    const poolDataSubgraphUrl = getUniswapV4SubgraphUrl(networkMode);
    if (!poolDataSubgraphUrl) {
      throw new Error('Uniswap V4 subgraph URL not found for pool data');
    }

    // Get pool config for token symbols and hook address
    const allPools = getAllPools(networkMode);
    const poolCfg = allPools.find(p => (getPoolSubgraphId(p.id, networkMode) || p.id).toLowerCase() === subgraphId);
    const sym0 = poolCfg?.currency0?.symbol || 'USDC';
    const sym1 = poolCfg?.currency1?.symbol || 'USDC';
    const hookAddress = poolCfg?.hooks?.toLowerCase() || '';

    // Get token prices for USD conversion (Redis-cached with stale-while-revalidate)
    const prices = await batchQuotePrices([sym0, sym1], 8453, networkMode);
    const p0 = prices[sym0] || 0;
    const p1 = prices[sym1] || 0;

    // Log warning if prices unavailable (better than silently using wrong values)
    if (!p0 || !p1) {
      console.warn('[pool-chart-data] Price fetch returned 0:', { sym0, p0, sym1, p1 });
    }

    // Generate date keys for the past N days
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days);

    const allDateKeys: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      allDateKeys.push(cursor.toISOString().split('T')[0]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const cutoffTimestamp = Math.floor(start.getTime() / 1000);
    const todayKey = new Date().toISOString().split('T')[0];
    const isTestnet = networkMode === 'testnet';

    // =============================================================================
    // STEP 1: Fetch volume from poolHourDatas (aggregated to daily)
    // =============================================================================
    const hourlyQuery = `{
      poolHourDatas(
        where: { pool: "${subgraphId}", periodStartUnix_gte: ${cutoffTimestamp} }
        orderBy: periodStartUnix
        orderDirection: desc
        first: 1000
      ) {
        periodStartUnix
        volumeToken0
        volumeToken1
      }
    }`;

    // =============================================================================
    // STEP 2: For testnet, fetch alphixHookTVLDayDatas for COMBINED historical TVL
    //         For mainnet, fall back to block-by-block pool TVL queries
    // =============================================================================
    let tvlDayDataQuery: string | null = null;
    let blocksQuery: string | null = null;

    if (isTestnet) {
      // Testnet: Use alphixHookTVLDayDatas for combined TVL (pool + rehypothecated)
      // Note: The subgraph's USD fields are not populated, so we use token amounts
      // and convert to USD using our price data.
      // Hook address filter is critical - without it we get wrong pool's TVL
      tvlDayDataQuery = `{
        alphixHookTVLDayDatas(
          where: { hook: "${hookAddress}" }
          orderBy: date
          orderDirection: desc
          first: ${days + 5}
        ) {
          id
          date
          totalAmount0
          totalAmount1
        }
        alphixHookTVLs(where: { hook: "${hookAddress}" }) {
          totalAmount0
          totalAmount1
        }
      }`;
    } else {
      // Mainnet: Build block number query for historical TVL
      const blockAliases = allDateKeys.filter(k => k !== todayKey).map((key) => {
        const alias = `b_${key.replace(/-/g, '_')}`;
        const ts = Math.floor(new Date(key + 'T23:59:59Z').getTime() / 1000);
        return `${alias}: transactions(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_lte: ${ts} }) { blockNumber }`;
      }).join('\n');
      blocksQuery = blockAliases ? `query Blocks {\n${blockAliases}\n}` : null;
    }

    // Fetch all data in parallel
    const [hourlyResult, tvlDataResult, feeEventsResult] = await Promise.all([
      // Query 1: Hourly volume data
      fetch(poolDataSubgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: hourlyQuery })
      }),

      // Query 2: TVL data (either alphixHookTVLDayDatas or block numbers)
      (tvlDayDataQuery || blocksQuery)
        ? fetch(poolDataSubgraphUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: tvlDayDataQuery || blocksQuery })
          })
        : Promise.resolve(null),

      // Query 3: Fee events
      fetch(`${baseUrl}/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(subgraphId)}&network=${networkMode}`)
    ]);

    if (!hourlyResult.ok) {
      throw new Error(`hourly query failed: ${hourlyResult.status}`);
    }

    const hourlyJson = await hourlyResult.json();
    if (hourlyJson.errors) {
      throw new Error(`hourly query errors: ${JSON.stringify(hourlyJson.errors)}`);
    }

    // Process hourly volume data - aggregate by date (both token0 and token1 for bi-directional volume)
    const hourlyData = hourlyJson?.data?.poolHourDatas || [];
    const vol0ByDate = new Map<string, number>();
    const vol1ByDate = new Map<string, number>();
    for (const h of hourlyData) {
      const date = new Date(h.periodStartUnix * 1000).toISOString().split('T')[0];
      vol0ByDate.set(date, (vol0ByDate.get(date) || 0) + Number(h.volumeToken0 || 0));
      vol1ByDate.set(date, (vol1ByDate.get(date) || 0) + Number(h.volumeToken1 || 0));
    }

    // =============================================================================
    // STEP 3: Process TVL data based on network
    // =============================================================================
    const tvlByDate = new Map<string, number>(); // Store USD values directly

    if (isTestnet && tvlDataResult) {
      // TESTNET: Use alphixHookTVLDayDatas for combined historical TVL
      const tvlJson = await tvlDataResult.json();

      if (!tvlJson.errors) {
        const dayDatas = tvlJson?.data?.alphixHookTVLDayDatas || [];

        // Map day data by date string - use token amounts since USD fields are not populated
        for (const d of dayDatas) {
          // Convert unix timestamp to date string
          const dateTs = Number(d.date);
          const dateStr = new Date(dateTs * 1000).toISOString().split('T')[0];

          // Calculate TVL from token amounts (already in human-readable format)
          const amt0 = Number(d.totalAmount0) || 0;
          const amt1 = Number(d.totalAmount1) || 0;
          const totalTvl = calculateTotalUSD(amt0, amt1, p0, p1);
          if (totalTvl > 0) {
            tvlByDate.set(dateStr, totalTvl);
          }
        }

        // Get current TVL from alphixHookTVLs for today (more accurate than day data)
        const hookTvl = tvlJson?.data?.alphixHookTVLs?.[0];
        if (hookTvl) {
          const todayTvl = calculateTotalUSD(
            Number(hookTvl.totalAmount0) || 0,
            Number(hookTvl.totalAmount1) || 0,
            p0, p1
          );
          if (todayTvl > 0) {
            tvlByDate.set(todayKey, todayTvl);
          }
        }
      }
    } else if (!isTestnet && tvlDataResult) {
      // MAINNET: Use block-by-block pool TVL queries
      const blocksJson = await tvlDataResult.json();
      const aliasToBlock = new Map<string, number>();

      if (!blocksJson.errors) {
        for (const key of allDateKeys) {
          if (key === todayKey) continue;
          const alias = `b_${key.replace(/-/g, '_')}`;
          const arr = blocksJson?.data?.[alias] || [];
          const block = Array.isArray(arr) && arr.length > 0 ? Number(arr[0]?.blockNumber) || 0 : 0;
          if (block > 0) {
            aliasToBlock.set(key, block);
          }
        }
      }

      // Query pool TVL at each historical block
      if (aliasToBlock.size > 0) {
        const poolAliases = Array.from(aliasToBlock.entries()).map(([key, block]) => {
          const alias = `p_${key.replace(/-/g, '_')}`;
          return `${alias}: pools(where: { id: "${subgraphId}" }, block: { number: ${block} }) { totalValueLockedToken0 totalValueLockedToken1 }`;
        }).join('\n');

        const poolsQuery = `query Pools {\n${poolAliases}\n}`;

        const poolsResult = await fetch(poolDataSubgraphUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: poolsQuery })
        });

        if (poolsResult.ok) {
          const poolsJson = await poolsResult.json();
          if (!poolsJson.errors) {
            for (const key of aliasToBlock.keys()) {
              const alias = `p_${key.replace(/-/g, '_')}`;
              const arr = poolsJson?.data?.[alias] || [];
              if (Array.isArray(arr) && arr[0]) {
                const tvl0 = Number(arr[0]?.totalValueLockedToken0) || 0;
                const tvl1 = Number(arr[0]?.totalValueLockedToken1) || 0;
                const tvlUSD = calculateTotalUSD(tvl0, tvl1, p0, p1);
                if (tvlUSD > 0) {
                  tvlByDate.set(key, tvlUSD);
                }
              }
            }
          }
        }
      }

      // Get current pool TVL for today (mainnet - pool only)
      const currentPoolQuery = `{ pools(where: { id: "${subgraphId}" }) { totalValueLockedToken0 totalValueLockedToken1 } }`;
      const currentResult = await fetch(poolDataSubgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: currentPoolQuery })
      });

      if (currentResult.ok) {
        const currentJson = await currentResult.json();
        const currentPool = currentJson?.data?.pools?.[0];
        if (currentPool) {
          const tvl0 = Number(currentPool.totalValueLockedToken0) || 0;
          const tvl1 = Number(currentPool.totalValueLockedToken1) || 0;
          const tvlUSD = calculateTotalUSD(tvl0, tvl1, p0, p1);
          if (tvlUSD > 0) {
            tvlByDate.set(todayKey, tvlUSD);
          }
        }
      }
    }

    // Process fee events
    let feeEvents: DynamicFeeEvent[] = [];
    if (feeEventsResult.ok) {
      feeEvents = await feeEventsResult.json();
      if (!Array.isArray(feeEvents)) feeEvents = [];
    }

    // =============================================================================
    // STEP 4: Build final chart data with forward-fill for missing TVL
    // =============================================================================
    const data: ChartDataPoint[] = [];
    let lastTvlUSD = 0;

    for (const dateKey of allDateKeys) {
      // Volume: bi-directional (token0 + token1) for complete swap volume
      const vol0 = vol0ByDate.get(dateKey) || 0;
      const vol1 = vol1ByDate.get(dateKey) || 0;
      const volumeUSD = calculateTotalUSD(vol0, vol1, p0, p1);

      // TVL: use pre-computed USD value with forward-fill
      const tvlUSD = tvlByDate.get(dateKey);
      let finalTvlUSD: number;
      if (tvlUSD !== undefined && tvlUSD > 0) {
        finalTvlUSD = tvlUSD;
        lastTvlUSD = tvlUSD;
      } else {
        finalTvlUSD = lastTvlUSD; // Forward-fill
      }

      data.push({
        date: dateKey,
        tvlUSD: finalTvlUSD,
        volumeUSD,
        feesUSD: 0,
      });
    }

    return {
      success: true,
      poolId,
      data,
      feeEvents,
      timestamp: Date.now()
    };

  } catch (error: any) {
    console.error('[pool-chart-data] Error:', error);
    throw error;
  }
}

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request)
  if (rateLimited) return rateLimited

  try {
    const requestUrl = new URL(request.url);
    const baseUrl = requestUrl.origin;
    const searchParams = requestUrl.searchParams;
    const poolId = searchParams.get('poolId');
    const daysParam = searchParams.get('days');

    if (!poolId) {
      return NextResponse.json(
        { success: false, message: 'poolId parameter is required' },
        { status: 400 }
      );
    }

    const days = parseInt(daysParam || '60', 10);
    if (!Number.isFinite(days) || days <= 0 || days > 120) {
      return NextResponse.json(
        { success: false, message: 'days must be between 1 and 120' },
        { status: 400 }
      );
    }

    // Get network mode from cookies (defaults to env var for new users)
    const cookieStore = await cookies();
    const networkCookie = cookieStore.get('alphix-network-mode');
    const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    const networkMode: NetworkMode = (networkCookie?.value === 'mainnet' || networkCookie?.value === 'testnet')
      ? networkCookie.value
      : envDefault;

    // Use poolKeys helper for consistent cache key naming (include network mode)
    const cacheKey = poolKeys.chart(poolId, days, networkMode);

    // Check Redis cache with staleness
    const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<ChartDataResponse>(
      cacheKey,
      5 * 60,   // 5 minutes fresh
      60 * 60   // 1 hour stale window
    );

    // Fresh cache: return immediately
    if (cachedData && !isStale && !isInvalidated) {
      return NextResponse.json(cachedData);
    }

    // Invalidated cache: blocking fetch (user just did an action)
    if (cachedData && isInvalidated) {
      const payload = await computeChartData(poolId, days, networkMode, baseUrl);
      await setCachedData(cacheKey, payload, 3600); // 1 hour TTL
      return NextResponse.json({ ...payload, isStale: false });
    }

    // Stale cache (not invalidated): return immediately, refresh in background
    if (cachedData && isStale) {
      // Trigger background revalidation (fire-and-forget)
      void computeChartData(poolId, days, networkMode, baseUrl)
        .then((payload) => setCachedData(cacheKey, payload, 3600))
        .catch((error) => {
          console.error('[pool-chart-data] Background revalidation failed:', error);
        });

      // Return stale data with flag
      return NextResponse.json({ ...cachedData, isStale: true });
    }

    // Cache miss: fetch fresh data
    const payload = await computeChartData(poolId, days, networkMode, baseUrl);

    // Cache the result
    await setCachedData(cacheKey, payload, 3600); // 1 hour

    return NextResponse.json(payload);

  } catch (error: any) {
    console.error('[pool-chart-data] Unexpected error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
