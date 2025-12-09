import { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';
import { getSubgraphUrlForPool, isDaiPool } from '../../../lib/subgraph-url-helper';

interface PoolDayData {
  date: number;
  volumeWFeeToken0: string;
  volumeWFeeToken1: string;
  volumeToken0: string;
  volumeToken1: string;
  tvlToken0: string;
  tvlToken1: string;
  currentFeeRateBps: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { poolId, days = 7 } = req.body;

  if (!poolId) {
    return res.status(400).json({ error: 'poolId required' });
  }

  const apiId = getPoolSubgraphId(poolId) || poolId;
  const isDAI = isDaiPool(poolId);

  console.log('[pool-metrics] Request:', { poolId, apiId: apiId.toLowerCase(), days, isDAI });

  // All TheGraph Studio subgraphs use the same Uniswap V4 schema
  const poolQueryOriginal = `
    query PoolMetrics($poolId: ID!, $days: Int!) {
      pool(id: $poolId) {
        id
        totalValueLockedToken0
        totalValueLockedToken1
        feeTier
        txCount
      }

      poolDayDatas(
        where: { pool: $poolId }
        first: $days
        orderBy: date
        orderDirection: desc
      ) {
        date
        volumeToken0
        volumeToken1
        tvlUSD
      }
    }
  `;

  // Satsuma schema (for DAI pools) - uses standard Uniswap V3 field names
  const poolQuerySatsuma = `
    query PoolMetrics($poolId: ID!, $days: Int!) {
      pool(id: $poolId) {
        id
        totalValueLockedToken0
        totalValueLockedToken1
        feeTier
        txCount
      }

      poolDayDatas(
        where: { pool: $poolId }
        first: $days
        orderBy: date
        orderDirection: desc
      ) {
        date
        volumeToken0
        volumeToken1
        tvlUSD
      }
    }
  `;

  const poolQuery = isDAI ? poolQuerySatsuma : poolQueryOriginal;

  // All TheGraph Studio subgraphs use currentRatio field
  const feeEventsQueryDai = `
    query GetFeeEvents($poolId: Bytes!) {
      alphixHooks(
        where: { pool: $poolId }
        orderBy: timestamp
        orderDirection: desc
        first: 100
      ) {
        timestamp
        newFeeBps
        currentRatio
        newTargetRatio
      }
    }
  `;

  const feeEventsQueryOld = `
    query GetFeeEvents($poolId: Bytes!) {
      alphixHooks(
        where: { pool: $poolId }
        orderBy: timestamp
        orderDirection: desc
        first: 100
      ) {
        timestamp
        newFeeBps
        currentRatio
        newTargetRatio
      }
    }
  `;

  const feeEventsQuery = isDaiPool(poolId) ? feeEventsQueryDai : feeEventsQueryOld;

  try {
    // Determine the appropriate subgraph URL for this pool
    // All pools now use the unified TheGraph Studio subgraph
    const subgraphUrlForPoolData = getSubgraphUrlForPool(poolId);

    const [poolResponse, feeResponse] = await Promise.all([
      fetch(subgraphUrlForPoolData, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: poolQuery,
          variables: { poolId: apiId.toLowerCase(), days }
        })
      }),
      fetch(subgraphUrlForPoolData, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: feeEventsQuery,
          variables: { poolId: apiId.toLowerCase() }
        })
      })
    ]);

    // Check response status first
    if (!poolResponse.ok) {
      console.error('[pool-metrics] Pool subgraph error:', poolResponse.status, poolResponse.statusText);
      return res.status(200).json({
        pool: null,
        metrics: {
          totalFeesToken0: 0,
          avgTVLToken0: 0,
          totalVolumeToken0: 0,
          currentFeeBps: 0,
          days: 0
        },
        dayData: []
      });
    }

    if (!feeResponse.ok) {
      console.error('[pool-metrics] Fee subgraph error:', feeResponse.status, feeResponse.statusText);
    }

    // Handle empty/malformed responses gracefully
    let poolResult: any;
    let feeResult: any;
    
    try {
      const poolText = await poolResponse.text();
      if (!poolText || poolText.trim() === '') {
        console.log('[pool-metrics] Empty pool response');
        poolResult = { data: { trackedPool: null, poolDayDatas: [] } };
      } else {
        poolResult = JSON.parse(poolText);
      }
    } catch (e) {
      console.error('[pool-metrics] Failed to parse pool response:', e);
      poolResult = { data: { trackedPool: null, poolDayDatas: [] } };
    }

    try {
      const feeText = await feeResponse.text();
      if (!feeText || feeText.trim() === '') {
        console.log('[pool-metrics] Empty fee response');
        feeResult = { data: { alphixHooks: [] } };
      } else {
        feeResult = JSON.parse(feeText);
      }
    } catch (e) {
      console.error('[pool-metrics] Failed to parse fee response:', e);
      feeResult = { data: { alphixHooks: [] } };
    }

    if (poolResult?.errors) {
      console.error('[pool-metrics] Pool query errors:', JSON.stringify(poolResult.errors, null, 2));
      // Return empty metrics for pools not yet in subgraph
      return res.status(200).json({
        pool: null,
        metrics: {
          totalFeesToken0: 0,
          avgTVLToken0: 0,
          totalVolumeToken0: 0,
          currentFeeBps: 0,
          days: 0
        },
        dayData: []
      });
    }

    if (feeResult?.errors) {
      console.error('[pool-metrics] Fee events query errors:', feeResult.errors);
    }

    const { data } = poolResult;
    const feeEvents = feeResult?.data?.alphixHooks || [];

    // All TheGraph Studio subgraphs now use the same schema with 'pool'
    const pool = data?.pool;

    if (!data?.poolDayDatas || data.poolDayDatas.length === 0) {
      console.log('[pool-metrics] No poolDayDatas found for pool. Pool may not be in subgraph yet.');
      // Return empty metrics instead of error for pools not yet in subgraph
      return res.status(200).json({
        pool: pool || null,
        metrics: {
          totalFeesToken0: 0,
          avgTVLToken0: 0,
          totalVolumeToken0: 0,
          currentFeeBps: 0,
          days: 0
        },
        dayData: []
      });
    }

    // Normalize day data to common format
    const dayDatas = data.poolDayDatas.map((day: any) => ({
      date: day.date,
      volumeToken0: day.volumeToken0,
      volumeToken1: day.volumeToken1,
      tvlToken0: day.tvlToken0 || '0', // Not available in Satsuma schema
      tvlToken1: day.tvlToken1 || '0', // Not available in Satsuma schema
      currentFeeRateBps: day.currentFeeRateBps || '0' // Not available in Satsuma schema
    }));


    if (dayDatas.length === 0) {
      return res.status(200).json({
        pool,
        metrics: {
          totalFeesToken0: 0,
          avgTVLToken0: 0,
          totalVolumeToken0: 0,
          currentFeeBps: 0,
          days: 0
        },
        dayData: []
      });
    }

    // Sort fee events by timestamp ascending for chronological processing
    const sortedFeeEvents = [...feeEvents].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    // Calculate fees for each day using the appropriate fee rate
    // We need to map each day to its active fee rate
    let totalFeesToken0 = 0;
    const sortedDayDatas = [...dayDatas].sort((a, b) => a.date - b.date);

    for (const day of sortedDayDatas) {
      const dayEndTimestamp = day.date + 86400; // End of day in seconds

      // Find the fee rate active during this day (last fee event before day end)
      let feeBps = 0;
      for (const event of sortedFeeEvents) {
        const eventTimestamp = Number(event.timestamp);
        if (eventTimestamp <= dayEndTimestamp) {
          feeBps = Number(event.newFeeBps || 0);
        } else {
          break;
        }
      }

      // Calculate fees: volume * (fee rate / 1000000)
      // newFeeBps is in millionths (1/1,000,000), not basis points
      const volumeToken0 = parseFloat(day.volumeToken0 || '0');
      const feeRate = feeBps / 1_000_000; // Convert to decimal
      const dayFees = volumeToken0 * feeRate;

      totalFeesToken0 += dayFees;
    }

    // Calculate TVL - for DAI pools use current pool TVL, for others average daily TVL
    let avgTVLToken0: number;
    if (isDAI && pool?.totalValueLockedToken0) {
      // For Satsuma schema, use current pool TVL (day data doesn't have TVL)
      avgTVLToken0 = parseFloat(pool.totalValueLockedToken0);
    } else {
      // For original schema, average the daily TVL values
      avgTVLToken0 = dayDatas.reduce((sum, day) => sum + parseFloat(day.tvlToken0 || '0'), 0) / dayDatas.length;
    }

    const totalVolumeToken0 = dayDatas.reduce((sum, day) => sum + parseFloat(day.volumeToken0 || '0'), 0);

    // For APY calculation, we'll work in token0 terms
    // Get the most recent actual fee rate from fee events (not the config flag)
    const currentActualFeeBps = sortedFeeEvents.length > 0 
      ? Number(sortedFeeEvents[sortedFeeEvents.length - 1].newFeeBps || 0)
      : 0;

    const metrics = {
      totalFeesToken0: totalFeesToken0, // Fees in token0
      avgTVLToken0: avgTVLToken0, // TVL in token0
      totalVolumeToken0: totalVolumeToken0, // Volume in token0
      currentFeeBps: currentActualFeeBps, // Actual current fee in basis points (millionths converted)
      days: dayDatas.length
    };

    // Cache for 5 minutes (300 seconds) at the edge, revalidate in background
    // This means Vercel CDN will serve cached response for 5 min, then revalidate
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      pool,
      metrics,
      dayData: dayDatas
    });
  } catch (error) {
    console.error('Error fetching pool metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch pool metrics' });
  }
}
