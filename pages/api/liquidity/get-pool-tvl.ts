import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getPoolById } from '../../../lib/pools-config';
import { publicClient } from '../../../lib/viemClient';
import { parseAbi, getAddress, type Hex } from 'viem';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi";

// Use the subgraph URL from other liquidity API files
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest";
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4");

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
    // First, check if the pool is initialized on-chain using the configured subgraph ID
    try {
        const poolConfig = getPoolById(poolId);
        if (poolConfig) {
            // Use the configured subgraph ID directly as the pool ID for contract calls
            const actualPoolId = poolConfig.subgraphId;
            
            // Check if pool is initialized
            const stateViewAbi = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
            const slot0Data = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbi,
                functionName: 'getSlot0',
                args: [actualPoolId as Hex]
            }) as readonly [bigint, number, number, number];
            
            const sqrtPriceX96 = slot0Data[0].toString();
            
            // If pool is not initialized, return 0 TVL immediately
            if (sqrtPriceX96 === '0') {
                console.log(`API: Pool ${poolId} is not initialized (sqrtPriceX96 is 0), returning TVL of 0`);
                return { tvlUSD: "0.0" };
            }
        }
    } catch (error) {
        console.warn(`API: Could not check pool initialization status for ${poolId}, proceeding with subgraph query:`, error);
    }

    // Convert friendly pool ID to subgraph ID
    const subgraphId = getPoolSubgraphId(poolId) || poolId;
    
    const variables = {
        poolId: subgraphId.toLowerCase(),
    };

    console.log(`API: Fetching TVL for trackedPool: ${poolId} (subgraph ID: ${subgraphId})`);

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