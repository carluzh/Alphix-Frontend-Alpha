import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, type Address } from 'viem';

// Helper function to safely parse amounts and prevent scientific notation errors
const safeParseUnits = (amount: string, decimals: number): bigint => {
  // Handle edge cases
  if (!amount || amount === "0" || amount === "0.0") {
    return 0n;
  }

  // Check for scientific notation (e.g., "1e-8")
  if (amount.toLowerCase().includes('e')) {
    // Convert scientific notation to decimal using parseFloat, then format
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount)) {
      throw new Error("Invalid number format");
    }
    const fullDecimalString = numericAmount.toFixed(decimals);
    const trimmedString = fullDecimalString.replace(/\.?0+$/, '');
    const finalString = trimmedString === '.' ? '0' : trimmedString;
    return parseUnits(finalString, decimals);
  }

  // For normal decimal strings, use parseUnits directly to preserve precision
  // viem's parseUnits handles decimal strings correctly without floating point errors
  return parseUnits(amount, decimals);
};
import { Token, CurrencyAmount } from '@uniswap/sdk-core';
import { tickToPrice } from '@uniswap/v3-sdk';
import { 
  TokenSymbol, 
  getPoolConfigForTokens,
  createTokenSDK,
  createPoolKeyFromConfig,
  createCanonicalPoolKey,
  getQuoterAddress,
  getStateViewAddress,
  getPoolById
} from '../../../lib/pools-config';
import { STATE_VIEW_ABI } from '../../../lib/abis/state_view_abi';
import { V4QuoterAbi, EMPTY_BYTES } from '../../../lib/swap-constants';
import { publicClient } from '../../../lib/viemClient';
import { ethers } from 'ethers';
import { findBestRoute, SwapRoute, routeToString } from '../../../lib/routing-engine';

interface GetQuoteRequest extends NextApiRequest {
  body: {
    fromTokenSymbol: TokenSymbol;
    toTokenSymbol: TokenSymbol;
    amountDecimalsStr: string;
    swapType?: 'ExactIn' | 'ExactOut';
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

  for (let i = 0; i < route.pools.length; i++) {
    const pool = route.pools[i];
    
    // For each hop, the intermediate currency is the "to" token of this hop
    // (except for the last hop where it's the final destination)
    let intermediateCurrency: Address;
    let targetToken: string;
    
    if (i === route.pools.length - 1) {
      // Last hop - intermediate currency is the final destination
      targetToken = route.path[route.path.length - 1];
    } else {
      // Not the last hop - intermediate currency is the next token in the path
      targetToken = route.path[i + 1];
    }
    
    const targetTokenSDK = createTokenSDK(targetToken as TokenSymbol, chainId);
    
    if (!targetTokenSDK) {
      throw new Error(`Failed to create token SDK for ${targetToken} (hop ${i})`);
    }
    
    if (!targetTokenSDK.address) {
      throw new Error(`Token SDK for ${targetToken} has undefined address (hop ${i})`);
    }
    
    intermediateCurrency = targetTokenSDK.address as Address;
    
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
      hookData: EMPTY_BYTES
    });
  }

  return pathKeys;
}

// Helper function to create pool key and determine swap direction
function createPoolKeyAndDirection(fromToken: Token, toToken: Token, poolConfig: any) {
  // Build canonical PoolKey based on Token ordering to mirror SDK docs
  const poolKey = createCanonicalPoolKey(fromToken, toToken, poolConfig.pool);
  // zeroForOne is true if swapping from currency0 to currency1
  const zeroForOne = fromToken.sortsBefore(toToken);
  return { poolKey, zeroForOne };
}

// Helper to get mid price from pool state (for price impact calculation)
// Uses current pool tick from state view, matching Uniswap's approach
async function getMidPrice(
  fromToken: Token,
  toToken: Token,
  poolConfig: any
): Promise<number | null> {
  try {
    const { poolKey, zeroForOne } = createPoolKeyAndDirection(fromToken, toToken, poolConfig);
    
    // Get pool ID
    const poolId = poolConfig.pool.subgraphId;
    
    // Get current tick from state view
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://sepolia.base.org';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const stateView = new ethers.Contract(getStateViewAddress(), STATE_VIEW_ABI as any, provider);
    
    const slot0 = await stateView.callStatic.getSlot0(poolId);
    const tickCurrent = slot0.tick;
    
    // Use tickToPrice to get mid price (same as Uniswap)
    const priceForPoolOrientation = tickToPrice(
      zeroForOne ? fromToken : toToken,
      zeroForOne ? toToken : fromToken,
      tickCurrent
    );

    // Align price direction with the requested swap (fromToken -> toToken)
    const midPrice = zeroForOne ? priceForPoolOrientation : priceForPoolOrientation.invert();
    
    // Get price: quote 1 unit of fromToken to get expected toToken amount
    const oneFromToken = CurrencyAmount.fromRawAmount(
      fromToken,
      ethers.utils.parseUnits('1', fromToken.decimals).toString()
    );
    const expectedOutput = midPrice.quote(oneFromToken);
    
    // Convert expected output to decimal number (toToken per 1 fromToken)
    const outputDecimal = parseFloat(ethers.utils.formatUnits(expectedOutput.quotient.toString(), toToken.decimals));
    return outputDecimal;
  } catch (error) {
    console.error('[getMidPrice] Error getting mid price:', error);
    return null;
  }
}

async function computeRouteMidPrice(route: SwapRoute, chainId: number): Promise<number | null> {
  if (!route.path || route.path.length < 2) return null;
  let cumulativePrice = 1;
  for (let i = 0; i < route.path.length - 1; i++) {
    const fromSymbol = route.path[i] as TokenSymbol;
    const toSymbol = route.path[i + 1] as TokenSymbol;
    const hopPoolConfig = getPoolConfigForTokens(fromSymbol, toSymbol);
    if (!hopPoolConfig) return null;
    const hopFromToken = createTokenSDK(fromSymbol, chainId);
    const hopToToken = createTokenSDK(toSymbol, chainId);
    if (!hopFromToken || !hopToToken) return null;
    const hopMidPrice = await getMidPrice(hopFromToken, hopToToken, hopPoolConfig);
    if (hopMidPrice === null) return null;
    cumulativePrice *= hopMidPrice;
  }
  return cumulativePrice;
}

// Helper function to call V4Quoter for single-hop exact input
async function getV4QuoteExactInputSingle(
  fromToken: Token,
  toToken: Token,
  amountInSmallestUnits: bigint,
  poolConfig: any
): Promise<{ amountOut: bigint; gasEstimate: bigint; midPrice?: number }> {
  const { poolKey, zeroForOne } = createPoolKeyAndDirection(fromToken, toToken, poolConfig);

  // Structure the parameters as QuoteExactSingleParams struct
  const quoteParams = [
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], // poolKey struct
    zeroForOne,
    amountInSmallestUnits,
    EMPTY_BYTES
  ] as const;

  try {

    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://sepolia.base.org';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const quoter = new ethers.Contract(getQuoterAddress(), V4QuoterAbi as any, provider);

    // Use the subgraphId directly as it's the actual on-chain poolId
    const poolId = poolConfig.pool.subgraphId;

    const stateView = new ethers.Contract(getStateViewAddress(), STATE_VIEW_ABI as any, provider);
    await stateView.callStatic.getSlot0(poolId);

    const [amountOut, gasEstimate] = await quoter.callStatic.quoteExactInputSingle(quoteParams);
    
    // Get mid price for price impact calculation
    const midPrice = await getMidPrice(fromToken, toToken, poolConfig);
    
    return { amountOut, gasEstimate, midPrice: midPrice || undefined };
  } catch (error: any) {
    throw error;
  }
}

// Helper function to call V4Quoter for single-hop exact output
async function getV4QuoteExactOutputSingle(
  fromToken: Token,
  toToken: Token,
  amountOutSmallestUnits: bigint,
  poolConfig: any
): Promise<{ amountIn: bigint; gasEstimate: bigint; midPrice?: number }> {
  const { poolKey, zeroForOne } = createPoolKeyAndDirection(fromToken, toToken, poolConfig);

  const quoteParams = [
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], // poolKey struct
    zeroForOne,
    amountOutSmallestUnits,
    EMPTY_BYTES
  ] as const;

  try {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://sepolia.base.org';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const quoter = new ethers.Contract(getQuoterAddress(), V4QuoterAbi as any, provider);

    const poolId = ethers.utils.solidityKeccak256(
      ['address','address','uint24','int24','address'],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
    );
    const stateView = new ethers.Contract(getStateViewAddress(), STATE_VIEW_ABI as any, provider);
    await stateView.callStatic.getSlot0(poolId);

    const [amountIn, gasEstimate] = await quoter.callStatic.quoteExactOutputSingle(quoteParams);
    
    // Get mid price for price impact calculation
    const midPrice = await getMidPrice(fromToken, toToken, poolConfig);
    
    return { amountIn, gasEstimate, midPrice: midPrice || undefined };
  } catch (error: any) {
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
  
  if (!fromToken.address) {
    throw new Error(`From token ${fromToken.symbol} has undefined address`);
  }
  
  // Encode the multi-hop path
  const pathKeys = encodeMultihopPath(route, chainId);
  
  

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
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://sepolia.base.org';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    // Preflight: verify each hop pool exists via StateView
    const stateView = new ethers.Contract(getStateViewAddress(), STATE_VIEW_ABI as any, provider);
    for (let i = 0; i < route.pools.length; i++) {
      const hop = route.pools[i];
      const poolCfg = getPoolById(hop.poolId);
      if (!poolCfg) {
        throw new Error(`Missing pool config for hop ${i}: ${hop.poolId}`);
      }
      const poolId = ethers.utils.solidityKeccak256(
        ['address','address','uint24','int24','address'],
        [poolCfg.currency0.address, poolCfg.currency1.address, poolCfg.fee, poolCfg.tickSpacing, poolCfg.hooks]
      );
      await stateView.callStatic.getSlot0(poolId);
    }

    const quoter = new ethers.Contract(quoterAddress, V4QuoterAbi as any, provider);
    const [amountOut, gasEstimate] = await quoter.callStatic.quoteExactInput(quoteParams);
    return { amountOut, gasEstimate };
  } catch (error: any) {
    throw error;
  }
}

// Helper function to call V4Quoter for multi-hop exact output
async function getV4QuoteExactOutputMultiHop(
  toToken: Token,
  route: SwapRoute,
  amountOutSmallestUnits: bigint,
  chainId: number
): Promise<{ amountIn: bigint; gasEstimate: bigint }> {
  try {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://sepolia.base.org';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    // Stepwise chain ExactOut over each hop (reliable across ABI quirks)
    let requiredOut = amountOutSmallestUnits; // smallest units of final token
    let totalGas = 0n;
    for (let i = route.pools.length - 1; i >= 0; i--) {
      const outSymbol = route.path[i + 1];
      const inSymbol = route.path[i];
      const outTok = createTokenSDK(outSymbol as any, chainId);
      const inTok = createTokenSDK(inSymbol as any, chainId);
      if (!outTok || !inTok) throw new Error(`Token SDK missing for hop ${i}: ${inSymbol}->${outSymbol}`);
      // Prefer resolving by token symbols for robustness
      let poolCfg = getPoolConfigForTokens(inSymbol as any, outSymbol as any);
      if (!poolCfg) {
        // Try reverse ordering if config sorted differently
        poolCfg = getPoolConfigForTokens(outSymbol as any, inSymbol as any);
      }
      if (!poolCfg) throw new Error(`Missing pool config for hop ${i}: ${inSymbol}->${outSymbol}`);

      // requiredOut is in outTok decimals already
      try {
        const { amountIn, gasEstimate } = await getV4QuoteExactOutputSingle(inTok, outTok, requiredOut, poolCfg);
        requiredOut = amountIn; // becomes the exact output target for previous hop
        totalGas += gasEstimate;
      } catch (hopErr: any) {
        console.error(`[V4 Quoter] ExactOut hop failed ${inSymbol} -> ${outSymbol} (hop ${i})`, hopErr);
        throw new Error(`ExactOut hop failed: ${inSymbol} -> ${outSymbol}`);
      }
    }
    return { amountIn: requiredOut, gasEstimate: totalGas };
  } catch (error: any) {
    throw error;
  }
}

export default async function handler(req: GetQuoteRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  try {
    const { fromTokenSymbol, toTokenSymbol, amountDecimalsStr, swapType = 'ExactIn' } = req.body;

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
    
    // Parse amount according to swap type
    const amountInSmallestUnits = swapType === 'ExactIn'
      ? safeParseUnits(amountDecimalsStr, fromToken.decimals)
      : 0n;
    const amountOutSmallestUnits = swapType === 'ExactOut'
      ? safeParseUnits(amountDecimalsStr, toToken.decimals)
      : 0n;
    
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
    
    let amountOut: bigint = 0n;
    let amountIn: bigint = 0n;
    let gasEstimate: bigint;
    let midPrice: number | null = null;
    
    if (swapType === 'ExactIn') {
      if (route.isDirectRoute) {
        const poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol);
        if (!poolConfig) {
          return res.status(400).json({ message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
        }
        const result = await getV4QuoteExactInputSingle(fromToken, toToken, amountInSmallestUnits, poolConfig);
        amountOut = result.amountOut;
        gasEstimate = result.gasEstimate;
        midPrice = result.midPrice || null;
      } else {
        const result = await getV4QuoteExactInputMultiHop(fromToken, route, amountInSmallestUnits, req.body.chainId);
        amountOut = result.amountOut;
        gasEstimate = result.gasEstimate;
        midPrice = await computeRouteMidPrice(route, req.body.chainId);
      }
    } else { // ExactOut
      if (route.isDirectRoute) {
        const poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol);
        if (!poolConfig) {
          return res.status(400).json({ message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
        }
        const result = await getV4QuoteExactOutputSingle(fromToken, toToken, amountOutSmallestUnits, poolConfig);
        amountIn = result.amountIn;
        gasEstimate = result.gasEstimate;
        midPrice = result.midPrice || null;
      } else {
        const result = await getV4QuoteExactOutputMultiHop(toToken, route, amountOutSmallestUnits, req.body.chainId);
        amountIn = result.amountIn;
        gasEstimate = result.gasEstimate;
        midPrice = await computeRouteMidPrice(route, req.body.chainId);
      }
    }
    
    // Format using ethers like the guide
    const toAmountDecimals = swapType === 'ExactIn' ? ethers.utils.formatUnits(amountOut, toToken.decimals) : amountDecimalsStr;
    const fromAmountDecimals = swapType === 'ExactOut' ? ethers.utils.formatUnits(amountIn, fromToken.decimals) : amountDecimalsStr;

    // Calculate price impact: (midPrice - executionPrice) / midPrice
    // Execution price = toAmount / fromAmount
    let priceImpact: number | null = null;
    if (midPrice !== null && parseFloat(fromAmountDecimals) > 0 && parseFloat(toAmountDecimals) > 0) {
      const executionPrice = parseFloat(toAmountDecimals) / parseFloat(fromAmountDecimals);
      if (midPrice > 0) {
        priceImpact = ((midPrice - executionPrice) / midPrice) * 100; // Convert to percentage
        // Ensure positive (price impact is always how much worse you're getting)
        if (priceImpact < 0) priceImpact = Math.abs(priceImpact);
        
        console.log('[get-quote] Price Impact Calculation:', {
          fromToken: fromTokenSymbol,
          toToken: toTokenSymbol,
          fromAmount: fromAmountDecimals,
          toAmount: toAmountDecimals,
          midPrice,
          executionPrice,
          priceImpact: `${priceImpact.toFixed(2)}%`,
        });
      }
    } else {
      console.log('[get-quote] Price Impact Skipped:', {
        midPrice,
        fromAmountDecimals,
        toAmountDecimals,
        reason: midPrice === null ? 'midPrice is null' : 'amounts are zero',
      });
    }

    return res.status(200).json({
      success: true,
      swapType,
      fromAmount: fromAmountDecimals,
      fromToken: fromTokenSymbol,
      toAmount: toAmountDecimals.toString(),
      toToken: toTokenSymbol,
      gasEstimate: gasEstimate.toString(),
      midPrice: midPrice !== null ? midPrice.toString() : undefined,
      priceImpact: priceImpact !== null ? priceImpact.toString() : undefined,
      route: {
        path: route.path,
        hops: route.hops,
        isDirectRoute: route.isDirectRoute,
        pools: route.pools.map(pool => pool.poolName)
      },
      debug: true
    });
  } catch (error: any) {
    console.error('[V4 Quoter API] Error:', error);
    
    // Check for specific error types
    let errorMessage = 'Failed to get quote';
    
    if (error instanceof Error) {
      const errorStr = error.message.toLowerCase();
      
      // Check for smart contract call exceptions (common in ExactOut multihop)
      if (errorStr.includes('call_exception') || 
          errorStr.includes('call revert exception') ||
          (errorStr.includes('0x6190b2b0') || errorStr.includes('0x486aa307'))) {
        if (req.body?.swapType === 'ExactOut') {
          errorMessage = 'Route not available for this amount';
        } else {
          errorMessage = 'Not enough liquidity';
        }
      }
      // Check for actual liquidity depth errors (be more specific)
      else if (errorStr.includes('insufficient liquidity for swap') || 
               errorStr.includes('not enough liquidity') ||
               errorStr.includes('pool has no liquidity')) {
        errorMessage = 'Not enough liquidity';
      }
      // Check for slippage-related errors  
      else if (errorStr.includes('price impact too high') ||
               errorStr.includes('slippage') ||
               errorStr.includes('price moved too much')) {
        errorMessage = 'Price impact too high';
      }
      // Generic revert without specific liquidity message
      else if (errorStr.includes('revert') || errorStr.includes('execution reverted')) {
        if (req.body?.swapType === 'ExactOut') {
          errorMessage = 'Cannot fulfill exact output amount';
        } else {
          errorMessage = 'Transaction would revert';
        }
      }
      // For ExactOut specific errors
      else if (req.body?.swapType === 'ExactOut' && (
        errorStr.includes('exceeds balance') ||
        errorStr.includes('insufficient balance') ||
        errorStr.includes('amount too large')
      )) {
        errorMessage = 'Amount exceeds available liquidity';
      }
    }
    
    return res.status(500).json({ success: false, error: errorMessage });
  }
} 