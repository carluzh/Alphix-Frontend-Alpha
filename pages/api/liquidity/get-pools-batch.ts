import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getAllPools } from '../../../lib/pools-config';
import { batchGetTokenPrices, calculateSwapVolumeUSD, calculateTotalUSD } from '../../../lib/price-service';
import { formatUnits } from 'viem';

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";

// Simple query to get basic pool data using the correct schema
const GET_POOLS_BASIC_QUERY = `
  query GetPoolsBasic($poolIds: [Bytes!]!) {
    trackedPools: trackedPools(where: { id_in: $poolIds }) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
      currency0 {
        symbol
        decimals
      }
      currency1 {
        symbol
        decimals
      }
    }
  }
`;

// Enhanced query to get all swap data needed for UI
const GET_RECENT_SWAPS_QUERY = `
  query GetRecentSwaps($poolIds: [Bytes!]!, $cutoff24h: BigInt!, $cutoff48h: BigInt!, $cutoff7d: BigInt!) {
    swaps24h: swaps(
      where: { pool_in: $poolIds, timestamp_gte: $cutoff24h }
      first: 1000
      orderBy: timestamp
      orderDirection: desc
    ) {
      pool { id }
      amount0
      amount1
      timestamp
      pool {
        currency0 { symbol decimals }
        currency1 { symbol decimals }
        currentFeeRateBps
      }
    }
    
    swaps48h: swaps(
      where: { pool_in: $poolIds, timestamp_gte: $cutoff48h }
      first: 1000
      orderBy: timestamp
      orderDirection: desc
    ) {
      pool { id }
      amount0
      amount1
      timestamp
      pool {
        currency0 { symbol decimals }
        currency1 { symbol decimals }
        currentFeeRateBps
      }
    }
    
    swaps7d: swaps(
      where: { pool_in: $poolIds, timestamp_gte: $cutoff7d }
      first: 1000
      orderBy: timestamp
      orderDirection: desc
    ) {
      pool { id }
      amount0
      amount1
      timestamp
      pool {
        currency0 { symbol decimals }
        currency1 { symbol decimals }
        currentFeeRateBps
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

    // Fetch basic pool data first
    console.log('[Batch API] Fetching basic pool data...');
    const poolResponse = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: GET_POOLS_BASIC_QUERY,
        variables: { poolIds: targetPoolIds },
      }),
    });

    if (!poolResponse.ok) {
      throw new Error(`Pool data request failed: ${poolResponse.status}`);
    }

    const poolData = await poolResponse.json();
    if (poolData.errors) {
      console.error('[Batch API] Pool data GraphQL errors:', poolData.errors);
      throw new Error(`GraphQL errors: ${JSON.stringify(poolData.errors)}`);
    }

    // Fetch swaps data
    console.log('[Batch API] Fetching swaps data...');
    const swapsResponse = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: GET_RECENT_SWAPS_QUERY,
        variables: {
          poolIds: targetPoolIds,
          cutoff24h: cutoff24h.toString(),
          cutoff48h: cutoff48h.toString(),
          cutoff7d: cutoff7d.toString(),
        },
      }),
    });

    if (!swapsResponse.ok) {
      throw new Error(`Swaps data request failed: ${swapsResponse.status}`);
    }

    const swapsData = await swapsResponse.json();
    if (swapsData.errors) {
      console.error('[Batch API] Swaps data GraphQL errors:', swapsData.errors);
      throw new Error(`GraphQL errors: ${JSON.stringify(swapsData.errors)}`);
    }

    const { trackedPools } = poolData.data;
    const { swaps24h, swaps48h, swaps7d } = swapsData.data;

    // Get all unique token symbols for price fetching
    const tokenSymbols = new Set<string>();
    trackedPools.forEach((pool: any) => {
      tokenSymbols.add(pool.currency0.symbol);
      tokenSymbols.add(pool.currency1.symbol);
    });

    console.log(`[Batch API] Fetching prices for ${tokenSymbols.size} tokens:`, Array.from(tokenSymbols));
    
    // Batch fetch all token prices (no fallbacks - let errors show)
    const tokenPrices = await batchGetTokenPrices(Array.from(tokenSymbols));
    console.log('[Batch API] Fetched token prices:', tokenPrices);

    // Process data for each pool
    const poolsStats: BatchPoolStats[] = [];

    for (const pool of trackedPools) {
      try {
        const poolId = pool.id;
        const token0Price = tokenPrices[pool.currency0.symbol];
        const token1Price = tokenPrices[pool.currency1.symbol];

        if (!token0Price || !token1Price) {
          console.warn(`[Batch API] Missing prices for pool ${poolId}, skipping`);
          continue;
        }

        // Calculate current TVL
        const tvlUSD = calculateTotalUSD(
          pool.totalValueLockedToken0,
          pool.totalValueLockedToken1,
          token0Price,
          token1Price
        );

        // Calculate volumes and fees
        const poolSwaps24h = swaps24h.filter((swap: any) => swap.pool.id === poolId);
        const poolSwaps48h = swaps48h.filter((swap: any) => swap.pool.id === poolId);
        const poolSwaps7d = swaps7d.filter((swap: any) => swap.pool.id === poolId);

        const calculateVolumeForSwaps = (swaps: any[]) => {
          return swaps.reduce((total: number, swap: any) => {
            const token0Decimals = parseInt(swap.pool.currency0.decimals);
            const token1Decimals = parseInt(swap.pool.currency1.decimals);
            
            const amount0Human = parseFloat(formatUnits(BigInt(Math.abs(parseFloat(swap.amount0))), token0Decimals));
            const amount1Human = parseFloat(formatUnits(BigInt(Math.abs(parseFloat(swap.amount1))), token1Decimals));
            
            const swapVolume = calculateSwapVolumeUSD(amount0Human, amount1Human, token0Price, token1Price);
            return total + swapVolume;
          }, 0);
        };

        const calculateFeesForSwaps = (swaps: any[]) => {
          return swaps.reduce((total: number, swap: any) => {
            const token0Decimals = parseInt(swap.pool.currency0.decimals);
            const token1Decimals = parseInt(swap.pool.currency1.decimals);
            
            const amount0Human = parseFloat(formatUnits(BigInt(Math.abs(parseFloat(swap.amount0))), token0Decimals));
            const amount1Human = parseFloat(formatUnits(BigInt(Math.abs(parseFloat(swap.amount1))), token1Decimals));
            
            const swapVolume = calculateSwapVolumeUSD(amount0Human, amount1Human, token0Price, token1Price);
            const feeRateBps = parseInt(swap.pool.currentFeeRateBps || '3000'); // Default to 0.3%
            // Correct conversion: 900 from subgraph = 0.09%, so divide by 1000000
            const feeRate = feeRateBps / 1000000; // Convert subgraph fee to decimal
            return total + (swapVolume * feeRate);
          }, 0);
        };

        const volume24hUSD = calculateVolumeForSwaps(poolSwaps24h);
        const volume48hUSD = calculateVolumeForSwaps(poolSwaps48h);
        const volume7dUSD = calculateVolumeForSwaps(poolSwaps7d);
        const fees24hUSD = calculateFeesForSwaps(poolSwaps24h);
        const fees7dUSD = calculateFeesForSwaps(poolSwaps7d);

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

    console.log(`[Batch API] Successfully processed ${poolsStats.length}/${trackedPools.length} pools`);

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