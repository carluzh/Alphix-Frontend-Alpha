import type { NextApiRequest, NextApiResponse } from 'next';

// Use the subgraph URL from other liquidity API files
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest";

// Querying 'trackedPool' by ID as per user-provided schema
const GET_POOL_TVL_QUERY = `
  query GetTrackedPoolTVL($poolId: Bytes!) {
    trackedPool(id: $poolId) {
      id
      tvlUSD
      # currency0 { # Not strictly needed for TVL but part of the example
      #   symbol
      # }
      # currency1 {
      #   symbol
      # }
    }
  }
`;

interface SubgraphTrackedPool {
    id: string;
    tvlUSD: string;
    // currency0?: { symbol: string }; // Optional, if needed later
    // currency1?: { symbol: string }; // Optional, if needed later
}

interface SubgraphTVLResponse {
    data?: {
        trackedPool: SubgraphTrackedPool | null; // trackedPool might not exist or return null
    };
    errors?: any[];
}

interface PoolTVL {
    tvlUSD: string;
}

async function fetchPoolTVLForApi(poolId: string): Promise<PoolTVL> {
    const variables = {
        poolId: poolId.toLowerCase(),
    };

    console.log(`API: Fetching TVL for trackedPool: ${poolId}`);

    const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: GET_POOL_TVL_QUERY,
            variables,
        }),
    });

    console.log("API: Request body sent to subgraph for TVL query:", JSON.stringify({
        query: GET_POOL_TVL_QUERY,
        variables,
    }, null, 2));

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`API: Subgraph query for TVL failed with status ${response.status}: ${errorBody}`);
        console.log(`Raw response from subgraph: ${errorBody}`);
        throw new Error(`Subgraph query for TVL failed: ${errorBody}`);
    }

    const result = (await response.json()) as SubgraphTVLResponse;

    console.log("API: Raw subgraph result object for TVL query:", result);

    if (result.errors) {
        console.error("API: Subgraph returned errors for TVL query:", result.errors);
        throw new Error(`Subgraph error(s) for TVL: ${JSON.stringify(result.errors)}`);
    }

    // Check for trackedPool and its data
    if (!result.data || !result.data.trackedPool) {
        console.warn(`API: Subgraph response is missing data.trackedPool or pool not found for ID ${poolId}.`, result);
        return { tvlUSD: "0.0" }; // Pool not found or no TVL data
    }

    const trackedPoolData = result.data.trackedPool;

    return {
        tvlUSD: parseFloat(trackedPoolData.tvlUSD).toFixed(18) // Ensure consistent formatting
    };
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<PoolTVL | { message: string; error?: any }>
) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const { poolId } = req.query;

    if (!poolId || typeof poolId !== 'string') {
        return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
    }

    try {
        const results = await fetchPoolTVLForApi(poolId);
        return res.status(200).json(results);
    } catch (error: any) {
        console.error(`API Error in /api/liquidity/get-pool-tvl for pool ${poolId}:`, error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching pool TVL.";
        const detailedError = process.env.NODE_ENV === 'development' ? { name: error.name, stack: error.stack } : {};
        return res.status(500).json({ message: errorMessage, error: detailedError });
    }
} 