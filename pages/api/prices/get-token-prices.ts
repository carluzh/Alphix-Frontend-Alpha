import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenPrice, getFallbackPrice } from '../../../lib/price-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  try {
    // Get BTC price
    const btcPrice = await getTokenPrice('BTC') || getFallbackPrice('BTC');
    
    // Get USDC price
    const usdcPrice = await getTokenPrice('USDC') || getFallbackPrice('USDC');
    
    return res.status(200).json({
      BTC: btcPrice,
      USDC: usdcPrice,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('[TokenPrices API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
} 