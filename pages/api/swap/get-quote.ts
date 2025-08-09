import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, type Address } from 'viem';

// Helper function to safely parse amounts and prevent scientific notation errors
const safeParseUnits = (amount: string, decimals: number): bigint => {
  // Convert scientific notation to decimal format
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount)) {
    throw new Error("Invalid number format");
  }
  
  // Convert to string with full decimal representation (no scientific notation)
  const fullDecimalString = numericAmount.toFixed(decimals);
  
  // Remove trailing zeros after decimal point
  const trimmedString = fullDecimalString.replace(/\.?0+$/, '');
  
  // If the result is just a decimal point, return "0"
  const finalString = trimmedString === '.' ? '0' : trimmedString;
  
  return parseUnits(finalString, decimals);
};
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
import { findBestRoute, SwapRoute, routeToString } from '../../../lib/routing-engine';

interface GetQuoteRequest extends NextApiRequest {
  body: {
    fromTokenSymbol: TokenSymbol;
    toTokenSymbol: TokenSymbol;
    amountDecimalsStr: string;
    chainId: number;
    debug?: boolean;
  };
}

// V4 PathKey type for multi-hop swaps
// Must match the ABI: (address,uint24,int24,address,bytes)
interface PathKey {
  intermediateCurrency: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  hookData: `0x${string}`;
}

// Helper function to encode multi-hop path for V4
function encodeMultihopPath(route: SwapRoute, chainId: number): PathKey[] {
  const pathKeys: PathKey[] = [];
  
  console.log(`[encodeMultihopPath] Encoding route with ${route.pools.length} pools:`, {
    path: route.path,
    poolCount: route.pools.length
  });
  
  for (let i = 0; i < route.pools.length; i++) {
    const pool = route.pools[i];
    
    // For each hop, the intermediate currency is the "to" token of this hop
    // (except for the last hop where it's the final destination)
    let intermediateCurrency: Address;
    let targetToken: string;
    
    if (i === route.pools.length - 1) {
      // Last hop - intermediate currency is the final destination
      targetToken = route.path[route.path.length - 1];
      console.log(`[encodeMultihopPath] Last hop ${i}: target token = ${targetToken}`);
    } else {
      // Not the last hop - intermediate currency is the next token in the path
      targetToken = route.path[i + 1];
      console.log(`[encodeMultihopPath] Hop ${i}: target token = ${targetToken}`);
    }
    
    const targetTokenSDK = createTokenSDK(targetToken as TokenSymbol, chainId);
    
    if (!targetTokenSDK) {
      throw new Error(`Failed to create token SDK for ${targetToken} (hop ${i})`);
    }
    
    if (!targetTokenSDK.address) {
      throw new Error(`Token SDK for ${targetToken} has undefined address (hop ${i})`);
    }
    
    intermediateCurrency = targetTokenSDK.address as Address;
    console.log(`[encodeMultihopPath] Hop ${i}: intermediateCurrency = ${intermediateCurrency}`);
    
    if (!pool.hooks) {
      throw new Error(`Pool at hop ${i} has undefined hooks address`);
    }
    
    // Create fresh Address objects to ensure proper typing
    const validatedIntermediateCurrency = getAddress(intermediateCurrency);
    const validatedHooks = getAddress(pool.hooks);
    
    pathKeys.push({
      intermediateCurrency: validatedIntermediateCurrency,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks: validatedHooks,
      hookData: '0x' as `0x${string}`
    });
  }
  
  console.log(`[encodeMultihopPath] Successfully encoded ${pathKeys.length} path keys`);
  return pathKeys;
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

// Helper function to call V4Quoter for single-hop exact input
async function getV4QuoteExactInputSingle(
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

  try {
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
  } catch (error: any) {
    console.error(`[V4 Quoter] Single-hop quote error:`, {
      message: error.message,
      signature: error.signature,
      cause: error.cause?.signature,
      data: error.data,
      shortMessage: error.shortMessage
    });
    
    // Handle specific error signatures - check multiple possible locations
    const errorSignature = error.signature || error.cause?.signature;
    if (errorSignature === '0x6190b2b0' || error.message?.includes('0x6190b2b0')) {
      throw new Error('Insufficient Liquidity');
    }
    
    // Re-throw other errors
    throw error;
  }
}

// Helper function to call V4Quoter for multi-hop exact input
async function getV4QuoteExactInputMultiHop(
  fromToken: Token,
  route: SwapRoute,
  amountInSmallestUnits: bigint,
  chainId: number
): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  
  console.log(`[V4 Quoter] Multi-hop debug info:`, {
    fromTokenSymbol: fromToken.symbol,
    fromTokenAddress: fromToken.address,
    fromTokenIsValid: !!fromToken.address,
    routePath: route.path,
    chainId
  });
  
  if (!fromToken.address) {
    throw new Error(`From token ${fromToken.symbol} has undefined address`);
  }
  
  // Encode the multi-hop path
  const pathKeys = encodeMultihopPath(route, chainId);
  
  console.log(`[V4 Quoter] Calling quoteExactInput for multi-hop:`, {
    path: routeToString(route),
    pathKeys: pathKeys.length,
    exactAmount: amountInSmallestUnits.toString(),
    fromTokenAddress: fromToken.address
  });
  
  // Debug the pathKeys before making the contract call
  console.log(`[V4 Quoter] Detailed pathKeys debug:`, pathKeys.map((pk, i) => ({
    hop: i,
    intermediateCurrency: pk.intermediateCurrency,
    intermediateType: typeof pk.intermediateCurrency,
    hooks: pk.hooks,
    hooksType: typeof pk.hooks,
    fee: pk.fee,
    tickSpacing: pk.tickSpacing
  })));

  // Structure the parameters as QuoteExactParams struct
  // ABI expects: (address,(address,uint24,int24,address,bytes)[],uint128)
  const validatedCurrencyIn = getAddress(fromToken.address);
  
  // Convert PathKey objects to arrays as expected by the ABI
  const pathTuples = pathKeys.map(pk => [
    pk.intermediateCurrency,  // address
    pk.fee,                   // uint24
    pk.tickSpacing,           // int24
    pk.hooks,                 // address
    pk.hookData               // bytes
  ] as const);
  
  const quoteParams = [
    validatedCurrencyIn,      // address currencyIn
    pathTuples,               // (address,uint24,int24,address,bytes)[] path
    amountInSmallestUnits     // uint128 amountIn
  ] as const;

  const quoterAddress = getQuoterAddress();
  
  console.log(`[V4 Quoter] Full quoteParams debug:`, {
    currencyIn: quoteParams[0],
    currencyInType: typeof quoteParams[0],
    pathLength: quoteParams[1].length,
    amountIn: quoteParams[2].toString(),
    quoterAddress: quoterAddress,
    quoterAddressType: typeof quoterAddress
  });
  
  // Debug the converted path tuples
  console.log(`[V4 Quoter] Path tuples:`, pathTuples.map((tuple, i) => ({
    hop: i,
    intermediateCurrency: tuple[0],
    fee: tuple[1],
    tickSpacing: tuple[2],
    hooks: tuple[3],
    hookData: tuple[4]
  })));

  // Validate quoter address
  if (!quoterAddress) {
    throw new Error(`Quoter address is invalid: ${quoterAddress} (type: ${typeof quoterAddress})`);
  }

  // Validate all addresses before making the contract call
  try {
    getAddress(quoteParams[0]); // This will throw if invalid
    pathTuples.forEach((tuple, i) => {
      try {
        getAddress(tuple[0]); // intermediateCurrency
        getAddress(tuple[3]); // hooks
      } catch (err) {
        throw new Error(`Invalid address in pathTuple ${i}: intermediateCurrency=${tuple[0]}, hooks=${tuple[3]}, error=${err}`);
      }
    });
  } catch (validationError: any) {
    throw new Error(`Address validation failed: ${validationError.message}`);
  }

  // Note: Cannot JSON.stringify quoteParams due to BigInt values

  try {
    const result = await publicClient.readContract({
      address: quoterAddress,
      abi: V4QuoterAbi,
      functionName: 'quoteExactInput',
      args: [quoteParams] // Keep the array wrapper for the struct
    }) as [bigint, bigint]; // [amountOut, gasEstimate]
    
    return {
      amountOut: result[0],
      gasEstimate: result[1]
    };
  } catch (error: any) {
    console.error(`[V4 Quoter] Multi-hop quote failed:`, {
      message: error.message,
      signature: error.signature,
      cause: error.cause?.signature,
      data: error.data,
      shortMessage: error.shortMessage
    });
    
    // Handle specific error signatures - check multiple possible locations
    const errorSignature = error.signature || error.cause?.signature;
    if (errorSignature === '0x6190b2b0' || error.message?.includes('0x6190b2b0')) {
      throw new Error('Insufficient Liquidity');
    }
    
    throw new Error(`Multi-hop quote failed: ${error.message || 'Unknown error'}`);
  }
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

    console.log(`[V4 Quoter] ${fromTokenSymbol} → ${toTokenSymbol}, amount: ${amountDecimalsStr}, chainId: ${req.body.chainId}`);
    
    // Create Token instances
    const fromToken = createTokenSDK(fromTokenSymbol, req.body.chainId);
    const toToken = createTokenSDK(toTokenSymbol, req.body.chainId);
    
    console.log(`[V4 Quoter] Token creation debug:`, {
      fromTokenSymbol,
      fromTokenValid: !!fromToken,
      fromTokenAddress: fromToken?.address,
      fromTokenAddressType: typeof fromToken?.address,
      toTokenSymbol,
      toTokenValid: !!toToken,
      toTokenAddress: toToken?.address,
      toTokenAddressType: typeof toToken?.address
    });
    
    // Additional validation - check for undefined addresses
    if (fromToken?.address === undefined || fromToken?.address === 'undefined') {
      return res.status(400).json({ 
        message: `From token ${fromTokenSymbol} has undefined address`,
        debug: { fromTokenAddress: fromToken?.address, type: typeof fromToken?.address }
      });
    }
    
    if (toToken?.address === undefined || toToken?.address === 'undefined') {
      return res.status(400).json({ 
        message: `To token ${toTokenSymbol} has undefined address`,
        debug: { toTokenAddress: toToken?.address, type: typeof toToken?.address }
      });
    }
    
    if (!fromToken || !toToken) {
      return res.status(400).json({ message: 'Failed to create token instances' });
    }
    
    // Parse the input amount to smallest units
    const amountInSmallestUnits = safeParseUnits(amountDecimalsStr, fromToken.decimals);
    
    // Find the best route using the routing engine
    const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol);
    
    if (!routeResult.bestRoute) {
      return res.status(400).json({ 
        message: `No route found for token pair: ${fromTokenSymbol} → ${toTokenSymbol}`,
        error: 'No available pools to complete this swap'
      });
    }

    const route = routeResult.bestRoute;
    console.log(`[V4 Quoter] Using route: ${routeToString(route)}`);
    
    let amountOut: bigint;
    let gasEstimate: bigint;
    
    if (route.isDirectRoute) {
      // Single-hop swap using existing logic
      const poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol);
      
      if (!poolConfig) {
        return res.status(400).json({ message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
      }
      
      const result = await getV4QuoteExactInputSingle(fromToken, toToken, amountInSmallestUnits, poolConfig);
      amountOut = result.amountOut;
      gasEstimate = result.gasEstimate;
    } else {
      // Multi-hop swap using new logic
      const result = await getV4QuoteExactInputMultiHop(fromToken, route, amountInSmallestUnits, req.body.chainId);
      amountOut = result.amountOut;
      gasEstimate = result.gasEstimate;
    }
    
    // Convert back to decimal string for response
    const toAmountDecimals = Number(amountOut) / Math.pow(10, toToken.decimals);
    
    return res.status(200).json({
      success: true,
      fromAmount: amountDecimalsStr,
      fromToken: fromTokenSymbol,
      toAmount: toAmountDecimals.toString(),
      toToken: toTokenSymbol,
      gasEstimate: gasEstimate.toString(),
      route: {
        path: route.path,
        hops: route.hops,
        isDirectRoute: route.isDirectRoute,
        pools: route.pools.map(pool => pool.poolName)
      },
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
        errorMessage = error.message; // Use the specific liquidity error message
      } else if (error.message.includes('execution reverted')) {
        errorMessage = 'Pool may not exist or be initialized for this token pair. Please check if the V4 pool exists with the specified parameters.';
      } else if (error.message.includes('V4_QUOTER_ADDRESS_PLACEHOLDER')) {
        errorMessage = 'V4Quoter contract address not configured';
      } else if (error.message.includes('Multi-hop quote failed')) {
        errorMessage = error.message;
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