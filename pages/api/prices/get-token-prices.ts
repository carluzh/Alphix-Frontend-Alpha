import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllTokenPrices } from '../../../lib/price-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  try {
    console.log('[TokenPrices API] Fetching all prices in one call...');
    
    // Get all prices in one API call - much more efficient!
    const allPrices = await getAllTokenPrices();
    
    console.log('[TokenPrices API] Successfully got all prices:', allPrices);
    
    return res.status(200).json({
      BTC: allPrices.BTC,
      USDC: allPrices.USDC,
      ETH: allPrices.ETH,
      timestamp: allPrices.lastUpdated
    });
  } catch (error: any) {
    console.error('[TokenPrices API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
} 