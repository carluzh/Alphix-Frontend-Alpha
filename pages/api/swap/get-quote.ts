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

// Helper function to call V4Quoter for single-hop exact input
async function getV4QuoteExactInputSingle(
  fromToken: Token,
  toToken: Token,
  amountInSmallestUnits: bigint,
  poolConfig: any
): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
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

    const poolId = ethers.utils.solidityKeccak256(
      ['address','address','uint24','int24','address'],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
      );

      const stateView = new ethers.Contract(getStateViewAddress(), STATE_VIEW_ABI as any, provider);
      await stateView.callStatic.getSlot0(poolId);

    const [amountOut, gasEstimate] = await quoter.callStatic.quoteExactInputSingle(quoteParams);
    return { amountOut, gasEstimate };
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
    
    // Format using ethers like the guide
    const toAmountDecimals = ethers.utils.formatUnits(amountOut, toToken.decimals);
    
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
    return res.status(500).json({ success: false, error: 'Failed to get quote' });
  }
} 