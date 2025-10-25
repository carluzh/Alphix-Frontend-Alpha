/**
 * API Endpoint: Calculate Position APY
 *
 * Calculates APY based on uncollected fees since last liquidity modification
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { calculatePositionAPY } from '@/lib/lifetime-fees';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { owner, tickLower, tickUpper, poolId, uncollectedFeesUSD, positionValueUSD, positionCreationTimestamp, poolAPY } = req.body;

  // Validate required fields
  if (!owner || tickLower === undefined || tickUpper === undefined || !poolId ||
      uncollectedFeesUSD === undefined || positionValueUSD === undefined || !positionCreationTimestamp) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: owner, tickLower, tickUpper, poolId, uncollectedFeesUSD, positionValueUSD, positionCreationTimestamp',
    });
  }

  try {
    const result = await calculatePositionAPY(
      owner,
      tickLower,
      tickUpper,
      poolId,
      uncollectedFeesUSD,
      positionValueUSD,
      positionCreationTimestamp,
      poolAPY // Pass the pre-calculated pool APY
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[get-lifetime-fees] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
