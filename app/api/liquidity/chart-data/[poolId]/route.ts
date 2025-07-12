import type { NextRequest } from 'next/server';
import { batchGetTokenPrices, calculateTotalUSD, calculateSwapVolumeUSD } from '../../../../../lib/price-service';
import { getTokenDecimals } from '../../../../../lib/pools-config';
import { formatUnits } from 'viem';

// Define the structure of the chart data points
interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  volumeUSD: number;
  tvlUSD: number; // Added back as it exists on PoolDayData via schema
  // feesUSD?: number; // We have fees, but the chart config doesn't use it yet
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
  if (friendlyPoolId.toLowerCase() === 'yusdc-btcrl') {
    return "0xbcc20db9b797e211e508500469e553111c6fa8d80f7896e6db60167bcf18ce13";
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

      return {
        date: new Date(parseInt(dailyEntry.date) * 1000).toISOString().split('T')[0],
        volumeUSD,
        tvlUSD,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); 

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