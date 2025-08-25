import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getAllPools, getTokenDecimals, getStateViewAddress } from '../../../lib/pools-config';
import { batchGetTokenPrices, calculateTotalUSD } from '../../../lib/price-service';
import { formatUnits } from 'viem';
import { publicClient } from '../../../lib/viemClient';
import { parseAbi, type Hex } from 'viem';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from '../../../lib/abis/state_view_abi';

// Read inside handler to avoid import-time crashes in serverless
const getSubgraphUrl = () => process.env.SUBGRAPH_URL as string | undefined;

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

interface BatchPoolStats {
  poolId: string;
  tvlUSD: number;
  volume24hUSD: number;
  volume48hUSD: number;
  volume7dUSD: number;
  fees24hUSD: number;
  fees7dUSD: number;
  volumeChangeDirection: 'up' | 'down' | 'neutral';
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

    // Reduce API pressure for consecutive requests on Vercel
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

    console.log('[Batch API] Starting simplified batch pool data fetch...');
    
    // Get all pool IDs
    const allPools = getAllPools();
    const targetPoolIds = allPools.map(pool => getPoolSubgraphId(pool.id) || pool.id);
    
    console.log(`[Batch API] Fetching data for ${targetPoolIds.length} pools:`, targetPoolIds);

    // Calculate time cutoffs
    const now = Math.floor(Date.now() / 1000);
    const cutoff24h = now - (24 * 60 * 60);
    const cutoff48h = now - (2 * 24 * 60 * 60);
    const cutoff7d = now - (7 * 24 * 60 * 60);

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
    const stateViewAbi = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
    const STATE_VIEW_ADDRESS = getStateViewAddress();

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

    // Hourly volume for all pools in one go (last ~25h)
    const cutoffHourly = now - (25 * 60 * 60);
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

    // ---- Process data per pool ----
    const poolsStats: BatchPoolStats[] = [];
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

        // Fee rate (on-chain)
        let poolFeeRate = 0.003; // default 0.3%
        try {
          const STATE_VIEW_ADDRESS = getStateViewAddress();
          const stateViewAbi = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
          const slot0 = await publicClient.readContract({
            address: STATE_VIEW_ADDRESS,
            abi: stateViewAbi,
            functionName: 'getSlot0',
            args: [poolId as Hex]
          }) as readonly [bigint, number, number, number];
          const lpFeeRaw = Number(slot0[3] ?? 3000);
          poolFeeRate = lpFeeRaw / 1_000_000;
        } catch {}

        // Volume 24h from hourly rollups
        let volume24hUSD = 0;
        const hours = hourlyByPoolId.get(poolId) || [];
        if (hours.length > 0) {
          const sumToken0 = hours.reduce((acc, h) => acc + (Number(h?.volumeToken0) || 0), 0);
          volume24hUSD = sumToken0 * safeToken0Price;
        }
        const fees24hUSD = volume24hUSD * poolFeeRate;

        // Placeholders for now
        const volume48hUSD = 0;
        const volume7dUSD = 0;
        const fees7dUSD = 0;

        // Change direction heuristic
        const volumePrevious24h = Math.max(0, volume48hUSD - volume24hUSD);
        let volumeChangeDirection: 'up' | 'down' | 'neutral' = 'neutral';
        if (volume24hUSD > volumePrevious24h) volumeChangeDirection = 'up';
        else if (volume24hUSD < volumePrevious24h) volumeChangeDirection = 'down';

        poolsStats.push({
          poolId,
          tvlUSD,
          volume24hUSD,
          volume48hUSD,
          volume7dUSD,
          fees24hUSD,
          fees7dUSD,
          volumeChangeDirection,
        });

        console.log(`[Batch API] Processed pool ${poolId}: TVL=$${tvlUSD.toFixed(2)}, Vol24h=$${volume24hUSD.toFixed(2)}`);
      } catch (error) {
        console.error(`[Batch API] Error processing pool ${pool.id}:`, error);
      }
    }

    console.log(`[Batch API] Successfully processed ${poolsStats.length}/${allPools.length} pools`);

    return res.status(200).json({
      success: true,
      pools: poolsStats,
      timestamp: Date.now(),
    });

  } catch (error) {
    console.error('[Batch API] Error in batch pool data fetch:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
} 