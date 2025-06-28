import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, type Address } from 'viem';
import { Token } from '@uniswap/sdk-core';
import { 
  TokenSymbol, 
  getPoolConfigForTokens,
  createTokenSDK,
  createPoolKeyFromConfig,
  getQuoterAddress,
  CHAIN_ID
} from '../../../lib/pools-config';
import { V4QuoterAbi, EMPTY_BYTES } from '../../../lib/swap-constants';
import { publicClient } from '../../../lib/viemClient';

interface GetQuoteRequest extends NextApiRequest {
  body: {
    fromTokenSymbol: TokenSymbol;
    toTokenSymbol: TokenSymbol;
    amountDecimalsStr: string;
    chainId: number;
    debug?: boolean;
  };
}

// Helper function to create pool key and determine swap direction
function createPoolKeyAndDirection(fromToken: Token, toToken: Token, poolConfig: any) {
  // Determine token order (same as build-tx.ts)
  const token0 = fromToken.sortsBefore(toToken) ? fromToken : toToken;
  const token1 = fromToken.sortsBefore(toToken) ? toToken : fromToken;
  
  const poolKey = createPoolKeyFromConfig(poolConfig.pool);
  
  // zeroForOne is true if swapping from currency0 to currency1
  const zeroForOne = fromToken.sortsBefore(toToken);
  
  return { poolKey, zeroForOne };
}

// Helper function to call V4Quoter for exact input
async function getV4QuoteExactInput(
  fromToken: Token,
  toToken: Token,
  amountInSmallestUnits: bigint,
  poolConfig: any
): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  const { poolKey, zeroForOne } = createPoolKeyAndDirection(fromToken, toToken, poolConfig);
  
  console.log(`[V4 Quoter] Calling quoteExactInputSingle:`, {
    poolKey,
    zeroForOne,
    exactAmount: amountInSmallestUnits.toString(),
    hookData: EMPTY_BYTES
  });
  
  // Structure the parameters as QuoteExactSingleParams struct
  const quoteParams = [
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], // poolKey struct
    zeroForOne,
    amountInSmallestUnits,
    EMPTY_BYTES
  ] as const;

  const result = await publicClient.readContract({
    address: getQuoterAddress(),
    abi: V4QuoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [quoteParams]
  }) as [bigint, bigint]; // [amountOut, gasEstimate]
  
  return {
    amountOut: result[0],
    gasEstimate: result[1]
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

    // Get pool configuration for these tokens
    const poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol);

    if (!poolConfig) {
      return res.status(400).json({ message: `No pool found for token pair: ${fromTokenSymbol} → ${toTokenSymbol}` });
    }

    console.log(`[V4 Quoter] ${fromTokenSymbol} → ${toTokenSymbol}, amount: ${amountDecimalsStr}`);
    
    // Create Token instances
    const fromToken = createTokenSDK(fromTokenSymbol, req.body.chainId);
    const toToken = createTokenSDK(toTokenSymbol, req.body.chainId);
    
    if (!fromToken || !toToken) {
      return res.status(400).json({ message: 'Failed to create token instances' });
    }
    
    // Parse the input amount to smallest units
    const amountInSmallestUnits = parseUnits(amountDecimalsStr, fromToken.decimals);
    
    // Get quote from V4Quoter
    const { amountOut, gasEstimate } = await getV4QuoteExactInput(fromToken, toToken, amountInSmallestUnits, poolConfig);
    
    // Convert back to decimal string for response
    const toAmountDecimals = Number(amountOut) / Math.pow(10, toToken.decimals);
    
    return res.status(200).json({
      success: true,
      fromAmount: amountDecimalsStr,
      fromToken: fromTokenSymbol,
      toAmount: toAmountDecimals.toString(),
      toToken: toTokenSymbol,
      gasEstimate: gasEstimate.toString(),
      debug: true
    });
  } catch (error: any) {
    console.error('[V4 Quoter] Error:', error);
    
    // Handle specific V4Quoter errors
    let errorMessage = 'Failed to get quote from V4Quoter';
    if (error.message) {
      if (error.message.includes('Pool does not exist') || error.message.includes('POOL_NOT_FOUND')) {
        errorMessage = 'Pool not found for this token pair';
      } else if (error.message.includes('Insufficient liquidity')) {
        errorMessage = 'Insufficient liquidity for this swap amount';
      } else if (error.message.includes('execution reverted')) {
        errorMessage = 'Pool may not exist or be initialized for this token pair. Please check if the V4 pool exists with the specified parameters.';
      } else if (error.message.includes('V4_QUOTER_ADDRESS_PLACEHOLDER')) {
        errorMessage = 'V4Quoter contract address not configured';
      } else {
        errorMessage = error.message;
      }
    }
    
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
} 