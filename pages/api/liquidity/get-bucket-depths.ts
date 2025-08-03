import { NextApiRequest, NextApiResponse } from 'next';
import { getAllPools } from '../../../lib/pools-config';

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";

interface HookPosition {
  pool: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
}

interface BucketData {
  tickLower: number;
  tickUpper: number;
  midTick: number;
  liquidityToken0: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let poolId: string | undefined;
  
  try {
    const { poolId: reqPoolId, tickLower, tickUpper, tickSpacing, bucketCount = 25 } = req.body;
    poolId = reqPoolId;

    if (!poolId || tickLower === undefined || tickUpper === undefined || !tickSpacing) {
      return res.status(400).json({ 
        error: 'Missing required parameters: poolId, tickLower, tickUpper, tickSpacing' 
      });
    }

    // Fetch real liquidity data from subgraph
    const graphqlQuery = {
      query: `
        query GetAllHookPositionsForDepth {
          hookPositions(first: 1000, orderBy: liquidity, orderDirection: desc) {
            pool
            tickLower
            tickUpper
            liquidity
          }
        }
      `,
      variables: {}
    };

    // Map pool ID to subgraph ID
    const pools = getAllPools();
    const pool = pools.find(p => p.id === poolId);
    const subgraphId = pool?.subgraphId;
    
    if (!subgraphId) {
      return res.status(400).json({ 
        error: 'Invalid poolId: no subgraphId found' 
      });
    }

    const response = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    });

    if (!response.ok) {
      throw new Error(`Subgraph request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${result.errors.map((e: any) => e.message).join(', ')}`);
    }

    if (!result.data || !result.data.hookPositions) {
      throw new Error('No hookPositions found in subgraph response');
    }

    // Filter positions for the specific pool
    const allPositions = result.data.hookPositions as HookPosition[];
    const relevantPositions = allPositions.filter(
      pos => pos.pool && pos.pool.toLowerCase().trim() === subgraphId.toLowerCase().trim()
    );

    // Calculate bucket size based on the range and desired bucket count
    const tickRange = tickUpper - tickLower;
    const rawBucketSize = tickRange / bucketCount;
    const bucketSize = Math.max(tickSpacing, Math.ceil(rawBucketSize / tickSpacing) * tickSpacing);

    const buckets: BucketData[] = [];
    
    // Generate buckets across the range
    for (let currentTick = tickLower; currentTick < tickUpper; currentTick += bucketSize) {
      const bucketTickLower = currentTick;
      const bucketTickUpper = Math.min(currentTick + bucketSize, tickUpper);
      const midTick = Math.floor((bucketTickLower + bucketTickUpper) / 2);
      
      // Calculate liquidity for this bucket by summing overlapping positions
      let bucketLiquidity = 0;
      
      for (const position of relevantPositions) {
        const posTickLower = parseInt(position.tickLower.toString());
        const posTickUpper = parseInt(position.tickUpper.toString());
        const posLiquidity = parseFloat(position.liquidity);
        
        // Check if position overlaps with this bucket
        if (posTickLower < bucketTickUpper && posTickUpper > bucketTickLower) {
          // For liquidity depth, we want the full liquidity amount if the position overlaps
          // This creates a step function that accurately represents liquidity depth
          bucketLiquidity += posLiquidity;
        }
      }
      
      buckets.push({
        tickLower: bucketTickLower,
        tickUpper: bucketTickUpper,
        midTick: midTick,
        liquidityToken0: bucketLiquidity.toFixed(2)
      });
    }

    return res.status(200).json({
      success: true,
      buckets: buckets,
      bucketSize: bucketSize,
      totalBuckets: buckets.length,
      totalPositions: relevantPositions.length
    });

  } catch (error: any) {
    console.error('Error in get-bucket-depths:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
} 