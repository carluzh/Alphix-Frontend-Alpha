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

    // Parse numeric inputs robustly and validate
    const lowerNum = Number(tickLower);
    const upperNum = Number(tickUpper);
    const spacingNum = Number(tickSpacing);
    const bucketCountNum = Number(bucketCount);

    if (!poolId || Number.isNaN(lowerNum) || Number.isNaN(upperNum) || !Number.isFinite(spacingNum) || spacingNum <= 0) {
      return res.status(400).json({
        error: 'Invalid parameters',
        details: {
          poolIdPresent: !!poolId,
          tickLower: tickLower,
          tickUpper: tickUpper,
          tickSpacing: tickSpacing,
          parsed: { lowerNum, upperNum, spacingNum }
        }
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

    // Map provided identifier to a subgraph ID
    // Accept either configured pool.id (e.g., "aeth-ausdt") OR the raw subgraphId (0x...)
    const pools = getAllPools();
    let subgraphId: string | undefined;

    // 1) Exact match on configured pool.id
    const byId = pools.find((p) => p.id === poolId);
    if (byId?.subgraphId) {
      subgraphId = byId.subgraphId;
    }

    // 2) Exact match on configured subgraphId
    if (!subgraphId) {
      const bySubgraph = pools.find(
        (p) => String(p.subgraphId).toLowerCase().trim() === String(poolId).toLowerCase().trim()
      );
      if (bySubgraph?.subgraphId) subgraphId = bySubgraph.subgraphId;
    }

    // 3) Heuristic: if the input looks like a 32-byte hex string, treat it as subgraphId
    if (!subgraphId) {
      const looksLikeHexId = /^0x[0-9a-fA-F]{64}$/.test(String(poolId));
      if (looksLikeHexId) subgraphId = String(poolId);
    }

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
      (pos) => pos.pool && pos.pool.toLowerCase().trim() === subgraphId!.toLowerCase().trim()
    );

    // Calculate bucket size based on the range and desired bucket count
    // Normalize and clamp the requested range; ensure lower < upper
    const normalizedLower = Math.floor(Math.min(lowerNum, upperNum));
    const normalizedUpper = Math.ceil(Math.max(lowerNum, upperNum));
    const effectiveRange = Math.max(1, normalizedUpper - normalizedLower);

    const safeBucketCount = Number.isFinite(bucketCountNum) && bucketCountNum > 0 ? bucketCountNum : 25;
    const rawBucketSize = effectiveRange / safeBucketCount;
    const bucketSize = Math.max(spacingNum, Math.ceil(rawBucketSize / spacingNum) * spacingNum);

    const buckets: BucketData[] = [];
    
    // Generate buckets across the range
    for (let currentTick = normalizedLower; currentTick < normalizedUpper; currentTick += bucketSize) {
      const bucketTickLower = currentTick;
      const bucketTickUpper = Math.min(currentTick + bucketSize, normalizedUpper);
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