import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getAllPools, getTokenDecimals } from '../../../lib/pools-config';
import { batchGetTokenPrices, calculateTotalUSD } from '../../../lib/price-service';
import { formatUnits } from 'viem';

// Read inside handler to avoid import-time crashes in serverless
const getSubgraphUrl = () => process.env.SUBGRAPH_URL as string | undefined;

// Simple in-memory server cache (per instance) to mirror chart endpoints
const serverCache = new Map<string, { data: any; ts: number }>();
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
// eslint-disable-next-line @typescript-eslint/naming-convention
export function __getServerCache() { return serverCache; }

// Global compute coalescing and debounce to avoid subgraph spam from public busts
let lastComputeAt = 0;
let lastPayload: any | null = null;
let inFlight: Promise<any> | null = null;

// Bulk TVL per pool
const GET_POOLS_TVL_BULK = `
  query GetPoolsTVL($poolIds: [String!]!) {
    pools(where: { id_in: $poolIds }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
  }
`;

// Bulk hourly volume for pools
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

// Block lookup for a given timestamp (<= ts)
const GET_BLOCK_FOR_TS = `
  query BlockForTs($ts: Int!) {
    transactions(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_lte: $ts }) {
      timestamp
      blockNumber
    }
  }
`;

// Bulk pools snapshot at a given block
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const SUBGRAPH_URL = getSubgraphUrl();
    if (!SUBGRAPH_URL) {
      return res.status(500).json({ success: false, message: 'SUBGRAPH_URL env var is required' });
    }

    // Match chart endpoints: allow CDN cache 1h and SWR 1h; support internal bypass
    const revalidateHint = req.headers['x-internal-revalidate'] === '1' || req.query.revalidate === '1';
    const expectedSecret = process.env.INTERNAL_API_SECRET || '';
    const providedSecret = (req.headers['x-internal-secret'] as string) || '';
    const isInternal = revalidateHint || (!!expectedSecret && providedSecret === expectedSecret);
    const bust = typeof (req.query?.bust as string | undefined) === 'string';
    // Honor noStore only for internal calls; public calls cannot force noStore
    const noStore = isInternal && (String(req.query?.noStore || '').toLowerCase() === '1' || String(req.query?.no_store || '').toLowerCase() === '1');
    if (revalidateHint) {
      // For internal warm: avoid edge cache for this response
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
    }

    // Server-side cache for the entire batch payload (single key)
    const cacheKey = 'all-pools-batch';
    if (!bust && !revalidateHint) {
      const cached = serverCache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < SIX_HOURS_MS) {
        return res.status(200).json(cached.data);
      }
    }

    // Public bust calls: coalesce and debounce to protect the subgraph
    if (!isInternal) {
      if (inFlight) {
        try {
          const data = await inFlight;
          return res.status(200).json(data);
        } catch {}
      }
      const now = Date.now();
      if (lastPayload && (now - lastComputeAt) < 1000) {
        return res.status(200).json(lastPayload);
      }
    }

    console.log('[Batch API] Starting simplified batch pool data fetch...');
    
    // Get all pool IDs
    const allPools = getAllPools();
    const targetPoolIds = allPools.map(pool => getPoolSubgraphId(pool.id) || pool.id);
    
    console.log(`[Batch API] Fetching data for ${targetPoolIds.length} pools:`, targetPoolIds);

    // Calculate time cutoffs
    const now = Math.floor(Date.now() / 1000);
    const cutoff24h = now - (24 * 60 * 60);
    const cutoff25h = now - (25 * 60 * 60);
    const cutoff49h = now - (49 * 60 * 60);
    const dayStart = Math.floor(now / 86400) * 86400; // UTC midnight today
    const dayStartPrev = dayStart - 86400; // UTC midnight yesterday
    const dayEndPrev = dayStartPrev + 86400 - 1; // end of yesterday

    // No more per-pool subgraph calls; use bulk queries below

    // Build a quick lookup for pool config (symbols/decimals from config)
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
    // Fee/APY computed client-side using StateView

    // Get all unique token symbols for price fetching
    const tokenSymbols = new Set<string>();
    for (const p of allPools) {
      tokenSymbols.add(p.currency0.symbol);
      tokenSymbols.add(p.currency1.symbol);
    }

    console.log(`[Batch API] Fetching prices for ${tokenSymbols.size} tokens:`, Array.from(tokenSymbols));
    
    // Batch fetch all token prices (no fallbacks - let errors show)
    const tokenPrices = await batchGetTokenPrices(Array.from(tokenSymbols));
    console.log('[Batch API] Fetched token prices:', tokenPrices);

    // ---- Bulk subgraph fetches ----
    const compute = async () => {
      // (the body from here to payload build remains the same)
      
      // TVL for all pools
      const tvlResp = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: GET_POOLS_TVL_BULK, variables: { poolIds: targetPoolIds.map((id) => id.toLowerCase()) } })
      });
      const tvlJson = tvlResp.ok ? await tvlResp.json() : { data: { pools: [] } };
      const tvlById = new Map<string, { tvl0: any; tvl1: any }>();
      for (const p of (tvlJson?.data?.pools || [])) {
        tvlById.set(String(p.id).toLowerCase(), { tvl0: p.totalValueLockedToken0, tvl1: p.totalValueLockedToken1 });
      }

      // Hourly volume for all pools in one go (last ~49h)
      const cutoffHourly = cutoff49h;
      const hourlyResp = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: GET_POOLS_HOURLY_BULK, variables: { poolIds: targetPoolIds.map((id) => id.toLowerCase()), cutoff: cutoffHourly } })
      });
      const hourlyJson = hourlyResp.ok ? await hourlyResp.json() : { data: { poolHourDatas: [] } };
      const hourlyByPoolId = new Map<string, Array<any>>();
      for (const h of (hourlyJson?.data?.poolHourDatas || [])) {
        const id = String(h?.pool?.id || '').toLowerCase();
        if (!id) continue;
        if (!hourlyByPoolId.has(id)) hourlyByPoolId.set(id, []);
        hourlyByPoolId.get(id)!.push(h);
      }

      // Previous-day TVL snapshot using block-at-timestamp approach (consistent with chart-data)
      let prevDayBlock = 0;
      try {
        const blkResp = await fetch(SUBGRAPH_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_BLOCK_FOR_TS, variables: { ts: dayEndPrev } })
        });
        if (blkResp.ok) {
          const blkJson = await blkResp.json();
          prevDayBlock = Number(blkJson?.data?.transactions?.[0]?.blockNumber) || 0;
        }
      } catch {}

      const prevTvlByPoolId = new Map<string, { tvl0: number; tvl1: number }>();
      if (prevDayBlock > 0) {
        try {
          const poolsAtBlockResp = await fetch(SUBGRAPH_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: GET_POOLS_AT_BLOCK_BULK, variables: { poolIds: targetPoolIds.map(id => id.toLowerCase()), block: prevDayBlock } })
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

      // (no internal fallbacks; rely solely on block snapshot)

      // ---- Process data per pool ----
      const poolsStats: BatchPoolStatsMinimal[] = [];
      for (const pool of allPools) {
        try {
          const poolId = (getPoolSubgraphId(pool.id) || pool.id).toLowerCase();
          const symbol0 = pool.currency0.symbol;
          const symbol1 = pool.currency1.symbol;
          const token0Price = tokenPrices[symbol0];
          const token1Price = tokenPrices[symbol1];

          // Prices service returns fallbacks; if still missing, treat as 0
          const safeToken0Price = typeof token0Price === 'number' ? token0Price : 0;
          const safeToken1Price = typeof token1Price === 'number' ? token1Price : 0;

          // TVL
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

          // Volume windows from hourly rollups (current: >= cutoff24h; previous: [cutoff49h, cutoff25h))
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

          // TVL yesterday from block snapshot (priced with current prices)
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
        } catch (error) {
          console.error(`[Batch API] Error processing pool ${pool.id}:`, error);
        }
      }

      console.log(`[Batch API] Successfully processed ${poolsStats.length}/${allPools.length} pools`);

      const payload = { success: true, pools: poolsStats, timestamp: Date.now() };
      return payload;
    };

    // Share computation if multiple callers hit concurrently
    if (!inFlight) {
      inFlight = compute().finally(() => { inFlight = null; });
    }
    const payload = await inFlight;
    lastPayload = payload;
    lastComputeAt = Date.now();

    // Validate payload before caching - prevent caching suspicious zero values
    if (payload?.pools && Array.isArray(payload.pools)) {
      let hasValidData = false;
      let suspiciousCount = 0;
      for (const pool of payload.pools) {
        const tvlNow = Number(pool?.tvlUSD || 0);
        const tvlY = Number(pool?.tvlYesterdayUSD || 0);
        const vol24 = Number(pool?.volume24hUSD || 0);
        const volPrev = Number(pool?.volumePrev24hUSD || 0);
        if (tvlNow > 1000) hasValidData = true;
        if ((tvlNow > 0 && tvlY === 0) || (vol24 === 0 && volPrev === 0)) suspiciousCount++;
      }
      const majoritySuspicious = suspiciousCount > (payload.pools.length / 2);
      if (!hasValidData || majoritySuspicious) {
        console.warn('[Batch API] Suspicious data detected - not caching this response');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(payload);
      }
    }

    // Category 1: align with chart endpoints (1h CDN) but primary is server cache (6h)
    // Only write to server cache unless explicitly told not to
    try { if (!noStore) serverCache.set(cacheKey, { data: payload, ts: Date.now() }); } catch {}
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
    return res.status(200).json(payload);

  } catch (error) {
    console.error('[Batch API] Error in batch pool data fetch:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
} 