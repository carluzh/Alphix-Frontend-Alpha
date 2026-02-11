import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, type Address } from 'viem';
import { getNetworkModeFromRequest, type NetworkMode } from '../../../lib/pools-config';
import { RetryUtility } from '../../../lib/retry-utility';
import { safeParseUnits } from '../../../lib/liquidity/utils/parsing/amountParsing';

// Simple in-memory cache with 15s TTL (matches Uniswap's 10s pattern)
const quoteCache = new Map<string, { result: any; timestamp: number }>();
const QUOTE_CACHE_TTL = 15_000;

function getCacheKey(body: any): string {
  return `${body.fromTokenSymbol}-${body.toTokenSymbol}-${body.amountDecimalsStr}-${body.swapType || 'ExactIn'}-${body.chainId}`;
}

// Retry only network errors, not contract reverts (liquidity errors should fail fast)
const shouldRetryRpc = (_attempt: number, error: any): boolean => {
  const msg = error?.message?.toLowerCase() || '';
  return msg.includes('timeout') || msg.includes('network') ||
         msg.includes('econnrefused') || msg.includes('etimedout');
};
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '../../../lib/network-mode';
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
import { V4QuoterAbi, EMPTY_BYTES } from '@/lib/swap/swap-constants';
import { getUsdsQuoteStateOverridesEthers, needsUsdsStateOverride } from '@/lib/swap/quote-state-override';
import { getRpcUrlForNetwork } from '../../../lib/viemClient';
import { ethers } from 'ethers';
import { findBestRoute, SwapRoute, routeToString } from '@/lib/swap/routing-engine';

/**
 * Create an ethers provider that skips network detection entirely.
 * StaticJsonRpcProvider trusts the network you pass and never calls eth_chainId.
 */
function createProvider(networkMode?: NetworkMode): ethers.providers.StaticJsonRpcProvider {
  const rpcUrl = getRpcUrlForNetwork(networkMode || 'testnet');
  const chainId = networkMode === 'mainnet' ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID;
  const networkName = networkMode === 'mainnet' ? 'base' : 'base-sepolia';

  return new ethers.providers.StaticJsonRpcProvider(
    { url: rpcUrl, timeout: 10000 },
    { chainId, name: networkName }
  );
}

interface GetQuoteRequest extends NextApiRequest {
  body: {
    fromTokenSymbol: TokenSymbol;
    toTokenSymbol: TokenSymbol;
    amountDecimalsStr: string;
    swapType?: 'ExactIn' | 'ExactOut';
    chainId: number;
    debug?: boolean;
    network?: 'mainnet' | 'testnet';
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
function encodeMultihopPath(route: SwapRoute, chainId: number, networkMode?: NetworkMode): PathKey[] {
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

    const targetTokenSDK = createTokenSDK(targetToken as TokenSymbol, chainId, networkMode);
    
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
  poolConfig: any,
  networkMode?: NetworkMode
): Promise<number | null> {
  try {
    const { poolKey, zeroForOne } = createPoolKeyAndDirection(fromToken, toToken, poolConfig);

    // Get pool ID
    const poolId = poolConfig.pool.subgraphId;

    // Get current tick from state view - use network-aware RPC
    const provider = createProvider(networkMode);
    const stateView = new ethers.Contract(getStateViewAddress(networkMode), STATE_VIEW_ABI as any, provider);
    
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

async function computeRouteMidPrice(route: SwapRoute, chainId: number, networkMode?: NetworkMode): Promise<number | null> {
  if (!route.path || route.path.length < 2) return null;
  let cumulativePrice = 1;
  for (let i = 0; i < route.path.length - 1; i++) {
    const fromSymbol = route.path[i] as TokenSymbol;
    const toSymbol = route.path[i + 1] as TokenSymbol;
    const hopPoolConfig = getPoolConfigForTokens(fromSymbol, toSymbol, networkMode);
    if (!hopPoolConfig) return null;
    const hopFromToken = createTokenSDK(fromSymbol, chainId, networkMode);
    const hopToToken = createTokenSDK(toSymbol, chainId, networkMode);
    if (!hopFromToken || !hopToToken) return null;
    const hopMidPrice = await getMidPrice(hopFromToken, hopToToken, hopPoolConfig, networkMode);
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
  poolConfig: any,
  networkMode?: NetworkMode
): Promise<{ amountOut: bigint; gasEstimate: bigint; midPrice?: number; dynamicFeeBps?: number }> {
  const { poolKey, zeroForOne } = createPoolKeyAndDirection(fromToken, toToken, poolConfig);

  // Structure the parameters as QuoteExactSingleParams struct
  const quoteParams = [
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], // poolKey struct
    zeroForOne,
    amountInSmallestUnits,
    EMPTY_BYTES
  ] as const;

  const quoterAddress = getQuoterAddress(networkMode);
  const stateViewAddress = getStateViewAddress(networkMode);
  const poolId = poolConfig.pool.subgraphId;

  try {
    const provider = createProvider(networkMode);
    const quoter = new ethers.Contract(quoterAddress, V4QuoterAbi as any, provider);
    const stateView = new ethers.Contract(stateViewAddress, STATE_VIEW_ABI as any, provider);

    // Verify pool exists
    const slot0 = await stateView.callStatic.getSlot0(poolId);

    // Convert lpFee (millionths) to basis points
    const dynamicFeeBps = Math.max(0, Math.round((Number(slot0.lpFee || 0) / 1_000_000) * 10_000 * 100) / 100);

    // Check if we need state overrides for USDS input swaps
    // Pool Manager only has ~375 USDS on-chain (rest is rehypothecated to Sky vault)
    const needsOverride = needsUsdsStateOverride(fromToken.address || '');

    let amountOut: bigint;
    let gasEstimate: bigint;

    if (needsOverride) {
      // Use raw eth_call with state overrides for USDS input swaps
      const calldata = quoter.interface.encodeFunctionData('quoteExactInputSingle', [quoteParams]);
      const stateOverrides = getUsdsQuoteStateOverridesEthers();

      const retryResult = await RetryUtility.execute(
        async () => {
          const result = await provider.send('eth_call', [
            { to: quoterAddress, data: calldata },
            'latest',
            stateOverrides
          ]);
          return quoter.interface.decodeFunctionResult('quoteExactInputSingle', result);
        },
        { attempts: 3, backoffStrategy: 'exponential', baseDelay: 500, maxDelay: 5000, shouldRetry: shouldRetryRpc, throwOnFailure: true }
      );
      [amountOut, gasEstimate] = retryResult.data!;
    } else {
      // Standard callStatic for non-USDS quotes
      const retryResult = await RetryUtility.execute(
        () => quoter.callStatic.quoteExactInputSingle(quoteParams),
        { attempts: 3, backoffStrategy: 'exponential', baseDelay: 500, maxDelay: 5000, shouldRetry: shouldRetryRpc, throwOnFailure: true }
      );
      [amountOut, gasEstimate] = retryResult.data!;
    }

    // Get mid price for price impact calculation
    const midPrice = await getMidPrice(fromToken, toToken, poolConfig, networkMode);

    return { amountOut, gasEstimate, midPrice: midPrice || undefined, dynamicFeeBps };
  } catch (error: any) {
    throw error;
  }
}

// Helper function to call V4Quoter for single-hop exact output
async function getV4QuoteExactOutputSingle(
  fromToken: Token,
  toToken: Token,
  amountOutSmallestUnits: bigint,
  poolConfig: any,
  networkMode?: NetworkMode
): Promise<{ amountIn: bigint; gasEstimate: bigint; midPrice?: number; dynamicFeeBps?: number }> {
  const { poolKey, zeroForOne } = createPoolKeyAndDirection(fromToken, toToken, poolConfig);

  const quoteParams = [
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], // poolKey struct
    zeroForOne,
    amountOutSmallestUnits,
    EMPTY_BYTES
  ] as const;

  const quoterAddress = getQuoterAddress(networkMode);
  const stateViewAddress = getStateViewAddress(networkMode);
  // Use subgraphId directly - DO NOT recalculate using keccak256
  const poolId = poolConfig.pool.subgraphId;

  // Check if we need state overrides for USDS input swaps
  // Pool Manager only has ~375 USDS on-chain (rest is rehypothecated to Sky vault)
  const needsOverride = needsUsdsStateOverride(fromToken.address || '');

  try {
    const provider = createProvider(networkMode);
    const quoter = new ethers.Contract(quoterAddress, V4QuoterAbi as any, provider);
    const stateView = new ethers.Contract(stateViewAddress, STATE_VIEW_ABI as any, provider);

    // Verify pool exists
    const slot0 = await stateView.callStatic.getSlot0(poolId);

    // Convert lpFee (millionths) to basis points
    const dynamicFeeBps = Math.max(0, Math.round((Number(slot0.lpFee || 0) / 1_000_000) * 10_000 * 100) / 100);

    let amountIn: bigint;
    let gasEstimate: bigint;

    if (needsOverride) {
      // Use raw eth_call with state overrides for USDS input swaps
      const calldata = quoter.interface.encodeFunctionData('quoteExactOutputSingle', [quoteParams]);
      const stateOverrides = getUsdsQuoteStateOverridesEthers();

      const retryResult = await RetryUtility.execute(
        async () => {
          const result = await provider.send('eth_call', [
            { to: quoterAddress, data: calldata },
            'latest',
            stateOverrides
          ]);
          return quoter.interface.decodeFunctionResult('quoteExactOutputSingle', result);
        },
        { attempts: 3, backoffStrategy: 'exponential', baseDelay: 500, maxDelay: 5000, shouldRetry: shouldRetryRpc, throwOnFailure: true }
      );
      [amountIn, gasEstimate] = retryResult.data!;
    } else {
      // Standard callStatic for non-USDS quotes
      const retryResult = await RetryUtility.execute(
        () => quoter.callStatic.quoteExactOutputSingle(quoteParams),
        { attempts: 3, backoffStrategy: 'exponential', baseDelay: 500, maxDelay: 5000, shouldRetry: shouldRetryRpc, throwOnFailure: true }
      );
      [amountIn, gasEstimate] = retryResult.data!;
    }

    // Get mid price for price impact calculation
    const midPrice = await getMidPrice(fromToken, toToken, poolConfig, networkMode);

    return { amountIn, gasEstimate, midPrice: midPrice || undefined, dynamicFeeBps };
  } catch (error: any) {
    console.error('[V4 Quoter ExactOutputSingle] FAILED:', {
      errorMessage: error.message,
      errorCode: error.code,
      errorReason: error.reason,
      errorData: error.data
    });
    throw error;
  }
}

// Helper function to call V4Quoter for multi-hop exact input
async function getV4QuoteExactInputMultiHop(
  fromToken: Token,
  route: SwapRoute,
  amountInSmallestUnits: bigint,
  chainId: number,
  networkMode?: NetworkMode
): Promise<{ amountOut: bigint; gasEstimate: bigint; dynamicFeeBps?: number }> {

  if (!fromToken.address) {
    throw new Error(`From token ${fromToken.symbol} has undefined address`);
  }

  // Encode the multi-hop path
  const pathKeys = encodeMultihopPath(route, chainId, networkMode);
  
  

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

  const quoterAddress = getQuoterAddress(networkMode);

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

  try {
    const provider = createProvider(networkMode);

    // Preflight: verify each hop pool exists via StateView
    const stateView = new ethers.Contract(getStateViewAddress(networkMode), STATE_VIEW_ABI as any, provider);
    let dynamicFeeBps: number | undefined;
    for (let i = 0; i < route.pools.length; i++) {
      const hop = route.pools[i];
      const poolCfg = getPoolById(hop.poolId, networkMode);
      if (!poolCfg) {
        throw new Error(`Missing pool config for hop ${i}: ${hop.poolId}`);
      }
      // Use subgraphId directly - DO NOT recalculate using keccak256
      const poolId = poolCfg.subgraphId;
      const slot0 = await stateView.callStatic.getSlot0(poolId);
      // Use fee from first pool (matches existing behavior in useSwapRoutingFees)
      if (i === 0) {
        dynamicFeeBps = Math.max(0, Math.round((Number(slot0.lpFee || 0) / 1_000_000) * 10_000 * 100) / 100);
      }
    }

    const quoter = new ethers.Contract(quoterAddress, V4QuoterAbi as any, provider);

    // Check if we need state overrides for USDS input swaps (works for multi-hop too)
    const needsOverride = needsUsdsStateOverride(fromToken.address || '');

    let amountOut: bigint;
    let gasEstimate: bigint;

    if (needsOverride) {
      // Use raw eth_call with state overrides for USDS input swaps
      const calldata = quoter.interface.encodeFunctionData('quoteExactInput', [quoteParams]);
      const stateOverrides = getUsdsQuoteStateOverridesEthers();

      const retryResult = await RetryUtility.execute(
        async () => {
          const result = await provider.send('eth_call', [
            { to: quoterAddress, data: calldata },
            'latest',
            stateOverrides
          ]);
          return quoter.interface.decodeFunctionResult('quoteExactInput', result);
        },
        { attempts: 3, backoffStrategy: 'exponential', baseDelay: 500, maxDelay: 5000, shouldRetry: shouldRetryRpc, throwOnFailure: true }
      );
      [amountOut, gasEstimate] = retryResult.data!;
    } else {
      // Standard callStatic for non-USDS quotes
      const retryResult = await RetryUtility.execute(
        () => quoter.callStatic.quoteExactInput(quoteParams),
        { attempts: 3, backoffStrategy: 'exponential', baseDelay: 500, maxDelay: 5000, shouldRetry: shouldRetryRpc, throwOnFailure: true }
      );
      [amountOut, gasEstimate] = retryResult.data!;
    }

    return { amountOut, gasEstimate, dynamicFeeBps };
  } catch (error: any) {
    console.error('[V4 Quoter ExactInputMultiHop] FAILED:', {
      errorMessage: error.message,
      errorCode: error.code
    });
    throw error;
  }
}

// Helper function to call V4Quoter for multi-hop exact output
async function getV4QuoteExactOutputMultiHop(
  toToken: Token,
  route: SwapRoute,
  amountOutSmallestUnits: bigint,
  chainId: number,
  networkMode?: NetworkMode
): Promise<{ amountIn: bigint; gasEstimate: bigint; dynamicFeeBps?: number }> {
  try {
    const _provider = createProvider(networkMode);

    let requiredOut = amountOutSmallestUnits;
    let totalGas = 0n;
    let dynamicFeeBps: number | undefined;

    for (let i = route.pools.length - 1; i >= 0; i--) {
      const outSymbol = route.path[i + 1];
      const inSymbol = route.path[i];
      const outTok = createTokenSDK(outSymbol as any, chainId, networkMode);
      const inTok = createTokenSDK(inSymbol as any, chainId, networkMode);
      if (!outTok || !inTok) throw new Error(`Token SDK missing for hop ${i}: ${inSymbol}->${outSymbol}`);

      let poolCfg = getPoolConfigForTokens(inSymbol as any, outSymbol as any, networkMode);
      if (!poolCfg) {
        poolCfg = getPoolConfigForTokens(outSymbol as any, inSymbol as any, networkMode);
      }
      if (!poolCfg) throw new Error(`Missing pool config for hop ${i}: ${inSymbol}->${outSymbol}`);

      try {
        const result = await getV4QuoteExactOutputSingle(inTok, outTok, requiredOut, poolCfg, networkMode);
        requiredOut = result.amountIn;
        totalGas += result.gasEstimate;
        // Use fee from first pool in swap direction (last in iteration)
        if (i === 0 && result.dynamicFeeBps !== undefined) {
          dynamicFeeBps = result.dynamicFeeBps;
        }
      } catch (hopErr: any) {
        console.error(`[V4 Quoter] ExactOut hop failed ${inSymbol} -> ${outSymbol} (hop ${i})`, hopErr);
        throw new Error(`ExactOut hop failed: ${inSymbol} -> ${outSymbol}`);
      }
    }
    return { amountIn: requiredOut, gasEstimate: totalGas, dynamicFeeBps };
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
    const { fromTokenSymbol, toTokenSymbol, amountDecimalsStr, swapType = 'ExactIn', network: networkParam } = req.body;

    const networkMode: NetworkMode = (networkParam === 'mainnet' || networkParam === 'testnet')
      ? networkParam
      : getNetworkModeFromRequest(req.headers.cookie);

    // Validate required fields
    if (!fromTokenSymbol || !toTokenSymbol || !amountDecimalsStr) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (fromTokenSymbol === toTokenSymbol) {
      return res.status(400).json({ message: 'From and To tokens cannot be the same' });
    }

    // Check cache first (15s TTL)
    const cacheKey = getCacheKey(req.body);
    const cached = quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL) {
      const ageSeconds = Math.floor((Date.now() - cached.timestamp) / 1000);
      const maxAgeRemaining = Math.max(0, Math.floor((QUOTE_CACHE_TTL - (Date.now() - cached.timestamp)) / 1000));
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Age', ageSeconds.toString());
      res.setHeader('Cache-Control', `private, max-age=${maxAgeRemaining}`);
      return res.status(200).json(cached.result);
    }

    // Only log if not a price quote (amount > 1) to reduce noise
    if (amountDecimalsStr !== '1') {
      console.log(`[V4 Quoter] ${fromTokenSymbol} → ${toTokenSymbol}, amount: ${amountDecimalsStr}, chainId: ${req.body.chainId}`);
    }

    // Create Token instances with network-aware config
    const fromToken = createTokenSDK(fromTokenSymbol, req.body.chainId, networkMode);
    const toToken = createTokenSDK(toTokenSymbol, req.body.chainId, networkMode);

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

    // Fail fast: reject if parsed amount is 0 but input wasn't explicitly zero
    // This preserves old behavior where invalid inputs threw errors
    const isExplicitZero = !amountDecimalsStr || amountDecimalsStr === '0' || amountDecimalsStr === '0.0';
    const parsedAmount = swapType === 'ExactIn' ? amountInSmallestUnits : amountOutSmallestUnits;
    if (parsedAmount === 0n && !isExplicitZero) {
      return res.status(400).json({ message: 'Invalid amount format' });
    }

    // Find the best route using the routing engine (network-aware)
    const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol, networkMode);

    if (!routeResult.bestRoute) {
      return res.status(400).json({
        message: `No route found for token pair: ${fromTokenSymbol} → ${toTokenSymbol}`,
        error: 'No available pools to complete this swap'
      });
    }

    const route = routeResult.bestRoute;

    let amountOut: bigint = 0n;
    let amountIn: bigint = 0n;
    let gasEstimate: bigint;
    let midPrice: number | null = null;
    let dynamicFeeBps: number | undefined;

    if (swapType === 'ExactIn') {
      if (route.isDirectRoute) {
        const poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol, networkMode);
        if (!poolConfig) {
          return res.status(400).json({ message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
        }
        const result = await getV4QuoteExactInputSingle(fromToken, toToken, amountInSmallestUnits, poolConfig, networkMode);
        amountOut = result.amountOut;
        gasEstimate = result.gasEstimate;
        midPrice = result.midPrice || null;
        dynamicFeeBps = result.dynamicFeeBps;
      } else {
        const result = await getV4QuoteExactInputMultiHop(fromToken, route, amountInSmallestUnits, req.body.chainId, networkMode);
        amountOut = result.amountOut;
        gasEstimate = result.gasEstimate;
        midPrice = await computeRouteMidPrice(route, req.body.chainId, networkMode);
        dynamicFeeBps = result.dynamicFeeBps;
      }
    } else { // ExactOut
      if (route.isDirectRoute) {
        const poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol, networkMode);
        if (!poolConfig) {
          return res.status(400).json({ message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
        }
        const result = await getV4QuoteExactOutputSingle(fromToken, toToken, amountOutSmallestUnits, poolConfig, networkMode);
        amountIn = result.amountIn;
        gasEstimate = result.gasEstimate;
        midPrice = result.midPrice || null;
        dynamicFeeBps = result.dynamicFeeBps;
      } else {
        const result = await getV4QuoteExactOutputMultiHop(toToken, route, amountOutSmallestUnits, req.body.chainId, networkMode);
        amountIn = result.amountIn;
        gasEstimate = result.gasEstimate;
        midPrice = await computeRouteMidPrice(route, req.body.chainId, networkMode);
        dynamicFeeBps = result.dynamicFeeBps;
      }
    }
    
    // Format using ethers like the guide
    const toAmountDecimals = swapType === 'ExactIn' ? ethers.utils.formatUnits(amountOut, toToken.decimals) : amountDecimalsStr;
    const fromAmountDecimals = swapType === 'ExactOut' ? ethers.utils.formatUnits(amountIn, fromToken.decimals) : amountDecimalsStr;

    // Calculate price impact: (midPrice - executionPrice) / midPrice
    // Execution price = toAmount / fromAmount
    // Uniswap sign convention (ref: interface/packages/uniswap/src/features/transactions/swap/utils/formatPriceImpact.ts):
    //   POSITIVE = unfavorable (user receives less than mid price → triggers warnings)
    //   NEGATIVE = favorable (user receives more than mid price → no warning)
    let priceImpact: number | null = null;
    if (midPrice !== null && parseFloat(fromAmountDecimals) > 0 && parseFloat(toAmountDecimals) > 0) {
      const executionPrice = parseFloat(toAmountDecimals) / parseFloat(fromAmountDecimals);
      if (midPrice > 0) {
        priceImpact = ((midPrice - executionPrice) / midPrice) * 100; // Convert to percentage
        // DO NOT use abs() - sign is meaningful per Uniswap convention:
        // Positive → unfavorable (show warning), Negative → favorable (no warning)

        if (priceImpact < -50 || priceImpact > 500) {
          priceImpact = null;
        }
      }
    }

    // Build response and cache it
    const responseData = {
      success: true,
      swapType,
      fromAmount: fromAmountDecimals,
      fromToken: fromTokenSymbol,
      toAmount: toAmountDecimals.toString(),
      toToken: toTokenSymbol,
      gasEstimate: gasEstimate.toString(),
      midPrice: midPrice !== null ? midPrice.toString() : undefined,
      priceImpact: priceImpact !== null ? priceImpact.toString() : undefined,
      dynamicFeeBps,
      route: {
        path: route.path,
        hops: route.hops,
        isDirectRoute: route.isDirectRoute,
        pools: route.pools.map(pool => pool.poolName)
      },
      debug: process.env.NODE_ENV !== 'production'
    };

    // Cache successful quote (15s TTL)
    quoteCache.set(cacheKey, { result: responseData, timestamp: Date.now() });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responseData);
  } catch (error: any) {
    console.error('[V4 Quoter API] Full Error Details:', {
      message: error.message,
      code: error.code,
      reason: error.reason,
      data: error.data,
      stack: error.stack?.substring(0, 500)
    });

    // Check for specific error types
    let errorMessage = 'Failed to get quote';
    
    if (error instanceof Error) {
      const errorStr = error.message.toLowerCase();
      
      // Check for smart contract call exceptions (common in ExactOut multihop)
      if (errorStr.includes('call_exception') ||
          errorStr.includes('call revert exception') ||
          (errorStr.includes('0x6190b2b0') || errorStr.includes('0x486aa307'))) {
        if (req.body?.swapType === 'ExactOut') {
          errorMessage = 'Amount exceeds available liquidity';
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