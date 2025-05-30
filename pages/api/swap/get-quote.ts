import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, type Address, type Hex } from 'viem';
import { Token } from '@uniswap/sdk-core';
import { PoolKey } from '@uniswap/v4-sdk';

import { publicClient } from '../../../lib/viemClient';
import {
    TOKEN_DEFINITIONS, TokenSymbol,
    V4_POOL_FEE,
    V4_POOL_TICK_SPACING,
    V4_POOL_HOOKS,
} from '../../../lib/swap-constants';

// V4 Quoter ABI (minimal version for the functions we need)
const V4_QUOTER_ABI = [
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "struct PoolKey",
            "name": "poolKey",
            "type": "tuple",
            "components": [
              {
                "internalType": "Currency",
                "name": "currency0",
                "type": "address"
              },
              {
                "internalType": "Currency",
                "name": "currency1",
                "type": "address"
              },
              {
                "internalType": "uint24",
                "name": "fee",
                "type": "uint24"
              },
              {
                "internalType": "int24",
                "name": "tickSpacing",
                "type": "int24"
              },
              {
                "internalType": "IHooks",
                "name": "hooks",
                "type": "address"
              }
            ]
          },
          {
            "internalType": "bool",
            "name": "zeroForOne",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "exactAmount",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "hookData",
            "type": "bytes"
          }
        ],
        "internalType": "struct IV4Quoter.QuoteExactSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactInputSingle",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "amountOut",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "gasEstimate",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Address of the deployed V4 Quoter contract 
// UPDATE THIS ADDRESS with the actual V4 Quoter contract address on your network
// Example for Base Sepolia: 0x4752ba5DBc23F44D41918EB030a4C75930df434c
const V4_QUOTER_ADDRESS = '0x4752ba5DBc23F44D41918EB030a4C75930df434c'; // Base Sepolia V4 Quoter

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

  console.log(`[V4 Quoter API] Request received:`, JSON.stringify(req.body, null, 2));

  try {
    const { fromTokenSymbol, toTokenSymbol, amountDecimalsStr, chainId, debug = true } = req.body;

    // Validate required fields
    if (!fromTokenSymbol || !toTokenSymbol || !amountDecimalsStr || !chainId) {
      console.error(`[V4 Quoter API] Missing required fields:`, {
        fromTokenSymbol, toTokenSymbol, amountDecimalsStr, chainId
      });
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (fromTokenSymbol === toTokenSymbol) {
      console.error(`[V4 Quoter API] Same tokens provided: ${fromTokenSymbol}`);
      return res.status(400).json({ message: 'From and To tokens cannot be the same' });
    }

    // Get token configurations
    const fromTokenConfig = TOKEN_DEFINITIONS[fromTokenSymbol];
    const toTokenConfig = TOKEN_DEFINITIONS[toTokenSymbol];

    if (!fromTokenConfig || !toTokenConfig) {
      console.error(`[V4 Quoter API] Invalid token symbol(s):`, {
        fromTokenSymbol, toTokenSymbol,
        fromTokenExists: !!fromTokenConfig,
        toTokenExists: !!toTokenConfig,
        availableTokens: Object.keys(TOKEN_DEFINITIONS)
      });
      return res.status(400).json({ message: 'Invalid token symbol(s)' });
    }

    // For simplicity, we're using debug mode by default
    // In a real implementation, this would call the V4 Quoter contract
    console.log(`[V4 Quoter API] Processing request: ${fromTokenSymbol} → ${toTokenSymbol}, amount: ${amountDecimalsStr}, debug: ${debug}`);
    
    // Calculate a mock output amount based on the hardcoded price ratio
    const fromAmount = parseFloat(amountDecimalsStr);
    let toAmount = 0;
    
    if (fromTokenSymbol === 'YUSDC' && toTokenSymbol === 'BTCRL') {
      // 1 YUSD = ~0.000013 BTCRL (at 77000 BTCRL/USD)
      toAmount = fromAmount / 77000;
      console.log(`[V4 Quoter API] Calculating YUSDC → BTCRL rate: ${fromAmount} / 77000 = ${toAmount}`);
    } else if (fromTokenSymbol === 'BTCRL' && toTokenSymbol === 'YUSDC') {
      // 1 BTCRL = ~77000 YUSD
      toAmount = fromAmount * 77000;
      console.log(`[V4 Quoter API] Calculating BTCRL → YUSDC rate: ${fromAmount} * 77000 = ${toAmount}`);
    } else {
      console.error(`[V4 Quoter API] Unsupported token pair: ${fromTokenSymbol} → ${toTokenSymbol}`);
      return res.status(400).json({ message: `Unsupported token pair: ${fromTokenSymbol} → ${toTokenSymbol}` });
    }
    
    // Add some small random variation to simulate price impact
    const variation = 1 + (Math.random() * 0.02 - 0.01); // ±1% random variation
    toAmount *= variation;
    console.log(`[V4 Quoter API] Applied price impact variation: ${variation.toFixed(4)}, final amount: ${toAmount}`);
    
    const response = {
      success: true,
      fromAmount: amountDecimalsStr,
      fromToken: fromTokenSymbol,
      toAmount: toAmount.toString(),
      toToken: toTokenSymbol,
      gasEstimate: '150000', // Mock gas estimate
      debug: true
    };
    
    console.log(`[V4 Quoter API] Returning quote:`, response);
    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[V4 Quoter API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
} 