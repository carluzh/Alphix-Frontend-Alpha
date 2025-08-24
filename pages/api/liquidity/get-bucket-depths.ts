import { NextApiRequest, NextApiResponse } from 'next';
import { getAllPools } from '../../../lib/pools-config';

// Simple in-memory cache and in-flight dedupe to prevent spamming the subgraph
type CacheVal = { ts: number; resp: any };
const CACHE = new Map<string, CacheVal>();
const INFLIGHT = new Map<string, Promise<any>>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

const SUBGRAPH_URL = process.env.SUBGRAPH_URL as string;
if (!SUBGRAPH_URL) {
  throw new Error('SUBGRAPH_URL env var is required');
}

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

    // Build a stable cache key for this request (use request params only)
    const cacheKey = JSON.stringify({ k: 'bucket-depths', poolId, tickLower: lowerNum, tickUpper: upperNum, spacingNum, bucketCountNum });

    // Serve cached response if fresh
    const cached = CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < TTL_MS) {
      return res.status(200).json(cached.resp);
    }

    // TEMPORARY: The current subgraph schema does not expose tickLower/tickUpper/liquidity on Position
    // so this endpoint cannot compute real depth right now. To avoid spamming the subgraph and 429s,
    // return an empty-but-successful payload and cache it for 10 minutes.
    const disabledResp = {
      success: true,
      buckets: [] as BucketData[],
      bucketSize: spacingNum,
      totalBuckets: 0,
      totalPositions: 0,
      disabled: true,
      message: 'Depth disabled: subgraph lacks tick/liquidity fields on Position',
    };
    CACHE.set(cacheKey, { ts: Date.now(), resp: disabledResp });
    return res.status(200).json(disabledResp);

    // --- The code below is kept for future re-enable when schema supports it ---
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
    const byId = pools.find((p) => p.id === poolId) || null;
    if (byId && (byId as any).subgraphId) {
      subgraphId = (byId as any).subgraphId as string;
    }

    // 2) Exact match on configured subgraphId
    if (!subgraphId) {
      const bySubgraph = pools.find(
        (p) => String((p as any).subgraphId).toLowerCase().trim() === String(poolId).toLowerCase().trim()
      ) || null;
      if (bySubgraph && (bySubgraph as any).subgraphId) subgraphId = (bySubgraph as any).subgraphId as string;
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
    // Snap the requested range to tickSpacing multiples to avoid visual shifts
    const alignedLower = Math.floor(Math.min(lowerNum, upperNum) / spacingNum) * spacingNum;
    const alignedUpper = Math.ceil(Math.max(lowerNum, upperNum) / spacingNum) * spacingNum;
    const effectiveRange = Math.max(spacingNum, alignedUpper - alignedLower);

    // Force bucket size to exactly one tickSpacing so each bar is one spacing wide
    const bucketSize = spacingNum;

    const buckets: BucketData[] = [];
    
    // Generate buckets across the range, starting on a spacing-aligned boundary
    for (let currentTick = alignedLower; currentTick < alignedUpper; currentTick += bucketSize) {
      const bucketTickLower = currentTick;
      const bucketTickUpper = Math.min(currentTick + bucketSize, alignedUpper);
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