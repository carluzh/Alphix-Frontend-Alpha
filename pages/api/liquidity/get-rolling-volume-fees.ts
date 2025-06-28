import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';

// Use the subgraph URL from get-positions.ts
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest";

// The GraphQL query to fetch swaps for a given pool within a time range
const GET_SWAPS_IN_TIME_RANGE_QUERY = `
  query GetPoolSwapsInTimeRange($poolId: Bytes!, $cutoffTimestamp: BigInt!) {
    swaps(
      where: {
        pool: $poolId,
        timestamp_gte: $cutoffTimestamp
      }
      # Ordering by timestamp can be helpful for debugging but not strictly necessary for sum
      # orderBy: timestamp
      # orderDirection: asc
      # You might want to limit the number of results if expecting a huge number of swaps
      first: 1000 # Adjust as needed
    ) {
      id
      timestamp
      amountUSD
      feesUSD
    }
  }
`;

interface SubgraphSwap {
    id: string;
    timestamp: string;
    amountUSD: string;
    feesUSD: string;
}

interface SubgraphResponse {
    data?: {
        swaps: SubgraphSwap[];
    };
    errors?: any[];
}

interface RollingVolumeAndFees {
    volumeUSD: string;
    feesUSD: string;
}

async function fetchRollingVolumeAndFeesForApi(
    poolId: string,
    days: number
): Promise<RollingVolumeAndFees> {
    // Convert friendly pool ID to subgraph ID
    const subgraphId = getPoolSubgraphId(poolId) || poolId;
    
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const cutoffTimestampInSeconds = nowInSeconds - (days * 24 * 60 * 60);

    const variables = {
        poolId: subgraphId.toLowerCase(), // Ensure poolId is lowercase for subgraph
        cutoffTimestamp: BigInt(cutoffTimestampInSeconds).toString(), // Use BigInt constructor and convert to string
    };

    console.log(`API: Fetching ${days}d volume/fees for pool: ${poolId} (subgraph ID: ${subgraphId})`);

    const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: GET_SWAPS_IN_TIME_RANGE_QUERY,
            variables,
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`API: Subgraph query failed with status ${response.status}: ${errorBody}`);
        throw new Error(`Subgraph query failed: ${errorBody}`);
    }

    const result = (await response.json()) as SubgraphResponse;

    if (result.errors) {
        console.error("API: Subgraph returned errors:", result.errors);
        throw new Error(`Subgraph error(s): ${JSON.stringify(result.errors)}`);
    }

    if (!result.data || !result.data.swaps) {
        console.warn(`API: Subgraph response is missing data.swaps field or it's null for pool ${poolId}.`, result);
        return { volumeUSD: "0.0", feesUSD: "0.0" }; // No swap data found
    }

    const swaps = result.data.swaps;

    if (swaps.length === 0) {
        console.log(`API: No swap data found for pool ${poolId} in the past ${days} days.`);
        return { volumeUSD: "0.0", feesUSD: "0.0" };
    }

    let totalVolumeUSD = 0.0;
    let totalFeesUSD = 0.0;

    for (const swap of swaps) {
        totalVolumeUSD += parseFloat(swap.amountUSD);
        totalFeesUSD += parseFloat(swap.feesUSD);
    }

    // Return the total volume and fees formatted as strings
    return {
        volumeUSD: totalVolumeUSD.toFixed(18), // Adjust decimal places as needed
        feesUSD: totalFeesUSD.toFixed(18) // Adjust decimal places as needed
    };
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<RollingVolumeAndFees | { message: string; error?: any }>
) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const { poolId, days } = req.query;

    if (!poolId || typeof poolId !== 'string') {
        return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
    }
    
    const parsedDays = parseInt(days as string, 10);
    if (isNaN(parsedDays) || parsedDays <= 0) {
         return res.status(400).json({ message: 'Valid positive integer \'days\' query parameter is required.' });
    }

    try {
        const results = await fetchRollingVolumeAndFeesForApi(poolId, parsedDays);
        return res.status(200).json(results);
    } catch (error: any) {
        console.error(`API Error in /api/liquidity/get-rolling-volume-fees for pool ${poolId} (${parsedDays} days):`, error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching rolling volume and fees.";
        const detailedError = process.env.NODE_ENV === 'development' ? { name: error.name, stack: error.stack } : {};
        return res.status(500).json({ message: errorMessage, error: detailedError });
    }
} 