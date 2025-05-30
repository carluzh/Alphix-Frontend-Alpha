import type { NextApiRequest, NextApiResponse } from 'next';
import { TOKEN_DEFINITIONS, TokenSymbol } from '../../../lib/swap-constants';

interface GetQuoteRequest extends NextApiRequest {
  body: {
    fromTokenSymbol: TokenSymbol;
    toTokenSymbol: TokenSymbol;
    amountDecimalsStr: string;
    chainId: number;
    debug?: boolean;
  };
}

export default async function handler(req: GetQuoteRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  try {
    const { fromTokenSymbol, toTokenSymbol, amountDecimalsStr } = req.body;

    // Validate required fields
    if (!fromTokenSymbol || !toTokenSymbol || !amountDecimalsStr) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (fromTokenSymbol === toTokenSymbol) {
      return res.status(400).json({ message: 'From and To tokens cannot be the same' });
    }

    // Get token configurations
    const fromTokenConfig = TOKEN_DEFINITIONS[fromTokenSymbol];
    const toTokenConfig = TOKEN_DEFINITIONS[toTokenSymbol];

    if (!fromTokenConfig || !toTokenConfig) {
      return res.status(400).json({ message: 'Invalid token symbol(s)' });
    }

    console.log(`[V4 Quoter] ${fromTokenSymbol} → ${toTokenSymbol}, amount: ${amountDecimalsStr}`);
    
    // Calculate output amount based on the hardcoded price ratio
    const fromAmount = parseFloat(amountDecimalsStr);
    let toAmount = 0;
    
    if (fromTokenSymbol === 'YUSDC' && toTokenSymbol === 'BTCRL') {
      // 1 YUSD = ~0.000013 BTCRL (at 77000 BTCRL/USD)
      toAmount = fromAmount / 77000;
    } else if (fromTokenSymbol === 'BTCRL' && toTokenSymbol === 'YUSDC') {
      // 1 BTCRL = ~77000 YUSD
      toAmount = fromAmount * 77000;
    } else {
      return res.status(400).json({ message: `Unsupported token pair: ${fromTokenSymbol} → ${toTokenSymbol}` });
    }
    
    // Add some small random variation to simulate price impact
    const variation = 1 + (Math.random() * 0.02 - 0.01); // ±1% random variation
    toAmount *= variation;
    
    return res.status(200).json({
      success: true,
      fromAmount: amountDecimalsStr,
      fromToken: fromTokenSymbol,
      toAmount: toAmount.toString(),
      toToken: toTokenSymbol,
      gasEstimate: '150000',
      debug: true
    });
  } catch (error: any) {
    console.error('[V4 Quoter] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
} 