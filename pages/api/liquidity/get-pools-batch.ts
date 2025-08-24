import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getAllPools, getTokenDecimals, getStateViewAddress } from '../../../lib/pools-config';
import { batchGetTokenPrices, calculateSwapVolumeUSD, calculateTotalUSD } from '../../../lib/price-service';
import { formatUnits } from 'viem';
import { publicClient } from '../../../lib/viemClient';
import { parseAbi, type Hex } from 'viem';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from '../../../lib/abis/state_view_abi';

// Use Satsuma by default; allow env override if provided
const SUBGRAPH_URL = process.env.SUBGRAPH_URL as string;
if (!SUBGRAPH_URL) {
  throw new Error('SUBGRAPH_URL env var is required');
}

// Query a single pool's TVL (per ID)
const GET_POOL_TVL_QUERY = `
  query GetPoolTVL($poolId: Bytes!) {
    pool(id: $poolId) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
  }
`;

// Enhanced query to get all swap data needed for UI
const GET_POOL_HOURLY_VOLUME_QUERY = `
  query GetPoolHourly($poolId: String!, $cutoff: Int!) {
    pools(where: { id: $poolId }) {
      poolHourData(
        where: { periodStartUnix_gte: $cutoff }
        orderBy: periodStartUnix
        orderDirection: desc
      ) {
        periodStartUnix
        volumeToken0
        volumeToken1
      }
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

    // No more raw swaps; we will query hourly volume per pool below

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

    // Process data for each pool
    const poolsStats: BatchPoolStats[] = [];

    for (const pool of allPools) {
      try {
        const poolId = (getPoolSubgraphId(pool.id) || pool.id).toLowerCase();
        const symbol0 = pool.currency0.symbol;
        const symbol1 = pool.currency1.symbol;
        const token0Price = tokenPrices[symbol0];
        const token1Price = tokenPrices[symbol1];

        if (!token0Price || !token1Price) {
          console.warn(`[Batch API] Missing prices for pool ${poolId}, skipping`);
          continue;
        }

        // Fetch TVL for this pool via singular query
        const tvlResp = await fetch(SUBGRAPH_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_POOL_TVL_QUERY, variables: { poolId } })
        });
        let tvlUSD = 0;
        if (tvlResp.ok) {
          const tvlJson = await tvlResp.json();
          const pData = tvlJson?.data?.pool;
          if (pData) {
            const cfg = poolIdToConfig.get(poolId)!;
            // Satsuma may return raw units; try to scale via decimals first, else accept as human-readable
            const toHuman = (val: any, decimals: number) => {
              try {
                // If val is an integer-like string, formatUnits works
                const bi = BigInt(String(val));
                return parseFloat(formatUnits(bi, decimals));
              } catch {
                // Already human-readable decimal
                const n = parseFloat(String(val));
                return Number.isFinite(n) ? n : 0;
              }
            };
            const amt0 = toHuman(pData.totalValueLockedToken0 || '0', cfg.dec0);
            const amt1 = toHuman(pData.totalValueLockedToken1 || '0', cfg.dec1);
            tvlUSD = calculateTotalUSD(amt0, amt1, token0Price, token1Price);
          }
        }

        // Fetch current LP fee from on-chain state (getSlot0)
        let poolFeeRate = 0.003; // default 0.3%
        try {
          const slot0 = await publicClient.readContract({
            address: STATE_VIEW_ADDRESS,
            abi: stateViewAbi,
            functionName: 'getSlot0',
            args: [poolId as Hex]
          }) as readonly [bigint, number, number, number];
          const lpFeeRaw = Number(slot0[3] ?? 3000);
          // Align with SwapInputView: percent display uses lpFee/10,000 (%), but
          // for arithmetic we need decimal fraction: lpFee / 1,000,000
          poolFeeRate = lpFeeRaw / 1_000_000;
        } catch (e) {
          // keep default
        }

        // Calculate volumes and fees
        // Hourly volume for last 25h window (to capture rounding)
        const cutoffHourly = now - (25 * 60 * 60);
        const hourlyResp = await fetch(SUBGRAPH_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_POOL_HOURLY_VOLUME_QUERY, variables: { poolId, cutoff: cutoffHourly } })
        });
        let volume24hUSD = 0;
        let volume48hUSD = 0; // not computed via hourly; derive approx from 7d if needed later
        let volume7dUSD = 0;  // could compute via daily/hourly; for now keep 0 unless required
        let fees24hUSD = 0;
        let fees7dUSD = 0;
        if (hourlyResp.ok) {
          const hourlyJson = await hourlyResp.json();
          const hours = hourlyJson?.data?.pools?.[0]?.poolHourData || [];
          // Per Yanis: compute 24h volume from hourly rollups as sum(volumeToken0) * price0
          const sumToken0 = hours.reduce((acc: number, h: any) => acc + (Number(h?.volumeToken0) || 0), 0);
          volume24hUSD = sumToken0 * token0Price;
          fees24hUSD = volume24hUSD * poolFeeRate;
        }

        // Calculate volume change direction
        const volumePrevious24h = volume48hUSD - volume24hUSD;
        let volumeChangeDirection: 'up' | 'down' | 'neutral' = 'neutral';
        if (volume24hUSD > volumePrevious24h) {
          volumeChangeDirection = 'up';
        } else if (volume24hUSD < volumePrevious24h) {
          volumeChangeDirection = 'down';
        }

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
        // Continue processing other pools
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