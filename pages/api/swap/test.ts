import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Forward the request to our get-quote API
    const response = await fetch(`${process.env.NEXT_PUBLIC_VERCEL_URL || 'http://localhost:3000'}/api/swap/get-quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromTokenSymbol: 'YUSDC',
        toTokenSymbol: 'BTCRL',
        amountDecimalsStr: '1',
        chainId: 84532, // Base Sepolia
        debug: true,
      }),
    });

    const data = await response.json();
    
    return res.status(response.status).json(data);
  } catch (error: any) {
    console.error('Error testing quote API:', error);
    return res.status(500).json({ error: 'Failed to test quote API', details: error.message });
  }
} 