import type { NextRequest } from 'next/server';
import { batchGetTokenPrices, calculateTotalUSD, calculateSwapVolumeUSD } from '../../../../../lib/price-service';
import { getTokenDecimals } from '../../../../../lib/pools-config';
import { formatUnits } from 'viem';

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
const cache = new Map<string, { data: PoolChartData; timestamp: number }>();
// const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // Old: 24 hours from last fetch

// Subgraph URL - ensure this is correct
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";

// Updated GraphQL query for new schema
const GET_POOL_DAILY_HISTORY_QUERY = `
  query GetPoolDailyHistory($poolId: Bytes!) {
    poolDayDatas(
      first: 30 
      orderBy: date
      orderDirection: desc 
      where: { pool: $poolId }
    ) {
      id
      date      
      volumeToken0
      volumeToken1
      tvlToken0
      tvlToken1
      pool {
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

  // Calculate midnight UTC timestamp for today
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const midnightTodayTimestamp = Math.floor(now.getTime() / 1000);

  // Check cache using the original friendlyPoolId as the cache key
  const cachedEntry = cache.get(friendlyPoolId);
  if (cachedEntry && (Math.floor(cachedEntry.timestamp / 1000) >= midnightTodayTimestamp)) {
    console.log(`[API Cache HIT] Returning cached chart data for pool: ${friendlyPoolId}`);
    return Response.json(cachedEntry.data);
  }
  console.log(`[API Cache MISS or STALE] Fetching chart data for pool: ${friendlyPoolId} (using subgraph ID: ${subgraphPoolId})`);

  try {
    const subgraphResponse = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: GET_POOL_DAILY_HISTORY_QUERY,
            variables: { 
              poolId: subgraphPoolId, 
            },
        }),
    });

    if (!subgraphResponse.ok) {
        const errorBody = await subgraphResponse.text();
        console.error(`Subgraph query failed with status ${subgraphResponse.status}: ${errorBody}`);
        throw new Error(`Subgraph query failed for chart data: ${errorBody}`);
    }

    const subgraphResult = await subgraphResponse.json();

    if (subgraphResult.errors) {
        console.error("Subgraph returned errors for chart data:", subgraphResult.errors);
        throw new Error(`Subgraph error(s) for chart data: ${JSON.stringify(subgraphResult.errors)}`);
    }

    const rawDailyData = subgraphResult.data?.poolDayDatas;
    if (!rawDailyData || !Array.isArray(rawDailyData)) {
      console.warn(`No daily data found or unexpected format for pool ${friendlyPoolId}`, subgraphResult.data);
      const emptyData: PoolChartData = { poolId: friendlyPoolId, data: [] };
      cache.set(friendlyPoolId, { data: emptyData, timestamp: Date.now() });
      return Response.json(emptyData);
    }

    // Extract token symbols for price fetching
    const tokenSymbols = rawDailyData.length > 0 ? [
      rawDailyData[0].pool.currency0.symbol,
      rawDailyData[0].pool.currency1.symbol
    ] : [];

    // Get token prices with fallbacks
    const tokenPrices = tokenSymbols.length > 0 ? await batchGetTokenPrices(tokenSymbols) : {};

     // First pass: Calculate basic data without dependencies
     const processedChartData: ChartDataPoint[] = rawDailyData.map((dailyEntry: any) => {
       const token0Symbol = dailyEntry.pool.currency0.symbol;
       const token1Symbol = dailyEntry.pool.currency1.symbol;
       
       // Get prices without fallbacks to see real errors
       const token0Price = tokenPrices[token0Symbol];
       const token1Price = tokenPrices[token1Symbol];
       
       if (!token0Price || !token1Price) {
         console.error(`Missing prices for chart data ${friendlyPoolId}:`, {
           token0Symbol,
           token1Symbol,
           token0Price,
           token1Price,
           availablePrices: Object.keys(tokenPrices)
         });
         throw new Error(`Missing price data for chart: ${token0Symbol}=${token0Price}, ${token1Symbol}=${token1Price}`);
       }
       
       const volumeUSD = calculateSwapVolumeUSD(
         dailyEntry.volumeToken0 || "0",
         dailyEntry.volumeToken1 || "0",
         token0Price,
         token1Price
       );

       const tvlUSD = calculateTotalUSD(
         dailyEntry.tvlToken0 || "0",
         dailyEntry.tvlToken1 || "0",
         token0Price,
         token1Price
       );

       // Calculate Volume/TVL Ratio
       const volumeTvlRatio = tvlUSD > 0 ? volumeUSD / tvlUSD : 0;
       
       return {
         date: new Date(parseInt(dailyEntry.date) * 1000).toISOString().split('T')[0],
         volumeUSD,
         tvlUSD,
         volumeTvlRatio,
         emaRatio: volumeTvlRatio, // Initial value, will be calculated in second pass
         dynamicFee: 0.3, // Initial value, will be calculated in second pass
       };
     }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

     // Second pass: Calculate EMA and dynamic fees
     for (let i = 1; i < processedChartData.length; i++) {
       const current = processedChartData[i];
       const prev = processedChartData[i - 1];
       
       // Calculate EMA
       const k = 2 / (10 + 1); // EMA period of 10
       current.emaRatio = current.volumeTvlRatio * k + prev.emaRatio * (1 - k);
       
       // Calculate Dynamic Fee
       const deadband = 0.02;
       let feeAdjustmentDirection = 0;
       
       if (current.volumeTvlRatio > current.emaRatio + deadband) {
         feeAdjustmentDirection = 1; // Increase fee
       } else if (current.volumeTvlRatio < current.emaRatio - deadband) {
         feeAdjustmentDirection = -1; // Decrease fee
       }
       
       const feeStepPercent = 0.01;
       const proposedStepPercent = feeStepPercent * feeAdjustmentDirection;
       
       if (feeAdjustmentDirection !== 0) {
         current.dynamicFee = Math.max(0.05, Math.min(1.0, prev.dynamicFee + proposedStepPercent));
       } else {
         current.dynamicFee = prev.dynamicFee;
       }
     } 

    const result: PoolChartData = {
      poolId: friendlyPoolId, // Return data associated with the friendly ID
      data: processedChartData,
    };

    cache.set(friendlyPoolId, { data: result, timestamp: Date.now() });
    console.log(`[API Cache SET] Cached chart data for pool: ${friendlyPoolId}`);

    return Response.json(result);

  } catch (error) {
    console.error(`Error fetching chart data for pool ${friendlyPoolId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return Response.json({ message: `Failed to fetch chart data: ${errorMessage}` }, { status: 500 });
  }
}

// Helper to ensure correct Next.js 13+ API route behavior (optional but good practice)
export const dynamic = 'force-dynamic'; // Ensures the route is re-evaluated on each request (if not cached) 