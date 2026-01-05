import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, encodeFunctionData, type Address, type Hex, type Abi, TransactionExecutionError } from 'viem';
import { validateChainId, validateAddress, checkTxRateLimit } from '../../../lib/tx-validation';

// Helper function to safely parse amounts and prevent scientific notation errors
const safeParseUnits = (amount: string, decimals: number): bigint => {
  // Handle edge case where amount is "0" or empty
  if (!amount || amount === "0" || amount === "0.0") {
    return 0n;
  }
  
  // Check if the amount is in scientific notation
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount)) {
    throw new Error("Invalid number format");
  }
  
  // If the string contains 'e' or 'E', it's in scientific notation - convert it
  if (amount.toLowerCase().includes('e')) {
    const fullDecimalString = numericAmount.toFixed(decimals);
    const trimmedString = fullDecimalString.replace(/\.?0+$/, '');
    const finalString = trimmedString === '.' ? '0' : trimmedString;
    return parseUnits(finalString, decimals);
  }
  
  // Otherwise, use the string directly to preserve precision
  return parseUnits(amount, decimals);
};
import { Token } from '@uniswap/sdk-core';
import { RoutePlanner, CommandType } from '@uniswap/universal-router-sdk';
import { Pool, Route as V4Route, PoolKey, V4Planner, Actions, encodeRouteToPath } from '@uniswap/v4-sdk';
import { BigNumber } from 'ethers'; // For V4Planner compatibility if it expects Ethers BigNumber

import { createNetworkClient } from '../../../lib/viemClient';
import {
    TokenSymbol,
    getPoolConfigForTokens,
    createTokenSDK,
    createPoolKeyFromConfig,
    createCanonicalPoolKey,
    getNetworkModeFromRequest,
} from '../../../lib/pools-config';
import { UniversalRouterAbi, TX_DEADLINE_SECONDS } from '../../../lib/swap-constants';
import { getUniversalRouterAddress, getStateViewAddress } from '../../../lib/pools-config';
import { findBestRoute, SwapRoute, routeToString } from '../../../lib/routing-engine';
import { STATE_VIEW_ABI } from '../../../lib/abis/state_view_abi';
import { ethers } from 'ethers';

// Define MaxUint160 here as well
const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff');

// --- Helper: Convert human-readable price to sqrtPriceLimitX96 ---
function priceToSqrtPriceX96(price: number, token0: Token, token1: Token): bigint {
    // The price parameter is the human-readable price of token1 in terms of token0.
    // We need to convert this to a raw price ratio of token1's smallest units per token0's smallest units.
    // raw_price = human_price * (10^token1_decimals / 10^token0_decimals)
    const decimalAdjustedPrice = price * (10 ** (token1.decimals - token0.decimals));
    const sqrtPrice = Math.sqrt(decimalAdjustedPrice);
    const Q96 = BigInt(2) ** BigInt(96);
    return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

// --- Helper: Calculate price limit based on token ordering ---
function calculatePriceLimitX96(
    limitPrice: string,
    inputToken: Token,
    outputToken: Token,
    zeroForOne: boolean
): bigint {
    const numericLimitPrice = parseFloat(limitPrice);
    
    // Determine the canonical token0 and token1 for the pool
    const token0 = inputToken.sortsBefore(outputToken) ? inputToken : outputToken;
    const token1 = inputToken.sortsBefore(outputToken) ? outputToken : inputToken;

    let priceT1perT0: number;
    
    if (zeroForOne) {
        // Selling token0 for token1, price of token1/token0 increases.
        // The price limit is a MAXIMUM price (ceiling).
        // The user provides the limit in terms of token1 per token0, which is the pool's price format.
        priceT1perT0 = numericLimitPrice;
    } else {
        // Selling token1 for token0, price of token1/token0 decreases.
        // The price limit is a MINIMUM price (floor).
        // The user provides the limit in terms of token0 per token1, so we must invert it
        // for the pool's token1/token0 price format.
        // NOTE: This assumes the UI provides the price as token0/token1 for this case.
        priceT1perT0 = 1 / numericLimitPrice;
    }
    
    return priceToSqrtPriceX96(priceT1perT0, token0, token1);
}

// --- Helper: Determine swap direction ---
function determineSwapDirection(inputToken: Token, outputToken: Token): boolean {
    // Returns true if token0 -> token1 (zeroForOne = true)
    // Returns false if token1 -> token0 (zeroForOne = false)
    return inputToken.sortsBefore(outputToken);
}

// --- Guide-Exact Helper: encodeMultihopExactInPath ---
type PathKeyGuide = {
  intermediateCurrency: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  hookData: string;
};

export function encodeMultihopExactInPath(
  poolKeys: PoolKey[],
  currencyIn: string
): PathKeyGuide[] {
  const pathKeys: PathKeyGuide[] = []
  let currentCurrencyIn = currencyIn
  
  for (let i = 0; i < poolKeys.length; i++) {
    // Determine the output currency for this hop
    const currencyOut = currentCurrencyIn === poolKeys[i].currency0
      ? poolKeys[i].currency1
      : poolKeys[i].currency0
    
    // Create path key for this hop
    const pathKey: PathKeyGuide = {
      intermediateCurrency: currencyOut,
      fee: poolKeys[i].fee,
      tickSpacing: poolKeys[i].tickSpacing,
      hooks: poolKeys[i].hooks,
      hookData: '0x'
    }
    
    pathKeys.push(pathKey)
    currentCurrencyIn = currencyOut // Output becomes input for next hop
  }
  
  return pathKeys
}

export function encodeMultihopExactOutPath(
  poolKeys: PoolKey[],
  currencyOut: string
): PathKeyGuide[] {
  const pathKeys: PathKeyGuide[] = []
  let currentCurrencyOut = currencyOut

  // For ExactOut, we process pools in reverse order to find intermediate currencies
  // But we build the path array in FORWARD order (same structure as ExactIn)
  for (let i = poolKeys.length - 1; i >= 0; i--) {
    // Determine the input currency for this hop (reverse direction)
    const currencyIn = currentCurrencyOut === poolKeys[i].currency0
      ? poolKeys[i].currency1
      : poolKeys[i].currency0

    // Create path key for this hop
    const pathKey: PathKeyGuide = {
      intermediateCurrency: currencyIn,
      fee: poolKeys[i].fee,
      tickSpacing: poolKeys[i].tickSpacing,
      hooks: poolKeys[i].hooks,
      hookData: '0x'
    }

    pathKeys.unshift(pathKey) // Add to FRONT to maintain forward order
    currentCurrencyOut = currencyIn // Input becomes output for next hop (going backwards)
  }

  return pathKeys
}


// --- Helper: Prepare V4 Exact Input Swap Data (Adapted from original swap.ts) ---
// This function can be kept within this file or moved to a separate utility if it grows.
interface V4PlanBuild {
    encodedActions: Hex;
    actions: any;
    params: any;
}

async function prepareV4ExactInSwapData(
    inputToken: Token,
    outputToken: Token,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    poolConfig: any
): Promise<V4PlanBuild> {
    const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig.pool);
    // Build plan per guide (no extra logging)

    const v4Planner = new V4Planner();
    
    // Action order will follow the guide exactly; no optional price limit used
    const sqrtPriceLimitX96 = 0n;

    const zeroForOne = getAddress(inputToken.address!) === v4PoolKey.currency0;
    v4Planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
        {
            poolKey: v4PoolKey,
            zeroForOne,
            amountIn: BigNumber.from(amountInSmallestUnits.toString()),
            amountOutMinimum: BigNumber.from(minAmountOutSmallestUnits.toString()),
            sqrtPriceLimitX96: BigNumber.from(sqrtPriceLimitX96.toString()),
            hookData: '0x'
        }
    ]);

    // Second: SETTLE_ALL per guide
    v4Planner.addAction(Actions.SETTLE_ALL, [
        zeroForOne ? v4PoolKey.currency0 : v4PoolKey.currency1,
        BigNumber.from(amountInSmallestUnits.toString()),
    ]);

    // Third: TAKE_ALL - take whatever amount the swap produced
    // For native ETH output, use a very low minimum (1 wei) to avoid precision issues
    // The SWAP action's amountOutMinimum already enforces the actual slippage protection
    const outputCurrency = zeroForOne ? v4PoolKey.currency1 : v4PoolKey.currency0;
    const isNativeOutput = outputCurrency === '0x0000000000000000000000000000000000000000';
    const takeAllMin = isNativeOutput ? 1n : (minAmountOutSmallestUnits * 95n) / 100n;
    
    v4Planner.addAction(Actions.TAKE_ALL, [
        outputCurrency,
        BigNumber.from(takeAllMin.toString())
    ]);

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

// --- Helper: Prepare V4 Exact Output Swap Data (Adapted) ---
async function prepareV4ExactOutSwapData(
    inputToken: Token,
    outputToken: Token,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    poolConfig: any,
    limitPrice?: string
): Promise<V4PlanBuild> {
    const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig.pool);
    // Build plan per guide (trimmed logs)

    const v4Planner = new V4Planner();
    
    // Calculate price limit if provided
    let sqrtPriceLimitX96 = 0n; // 0 means no limit
    if (limitPrice && limitPrice !== "" && parseFloat(limitPrice) > 0) {
        const zeroForOne = getAddress(inputToken.address!) === v4PoolKey.currency0;
        sqrtPriceLimitX96 = calculatePriceLimitX96(limitPrice, inputToken, outputToken, zeroForOne);
    }

    v4Planner.addAction(Actions.SWAP_EXACT_OUT_SINGLE, [
        {
            poolKey: v4PoolKey,
            zeroForOne: getAddress(inputToken.address!) === v4PoolKey.currency0,
            amountOut: BigNumber.from(amountOutSmallestUnits.toString()),
            amountInMaximum: BigNumber.from(maxAmountInSmallestUnits.toString()),
            sqrtPriceLimitX96: BigNumber.from(sqrtPriceLimitX96.toString()),
            hookData: '0x'
        }
    ]);

    // After swap, settle input currency up to max
    const zeroForOne = getAddress(inputToken.address!) === v4PoolKey.currency0;
    v4Planner.addAction(Actions.SETTLE_ALL, [
        zeroForOne ? v4PoolKey.currency0 : v4PoolKey.currency1,
        BigNumber.from(maxAmountInSmallestUnits.toString()),
    ]);

    // Take all of the output currency (amountOut owed to caller)
    v4Planner.addAction(Actions.TAKE_ALL, [
        zeroForOne ? v4PoolKey.currency1 : v4PoolKey.currency0,
        BigNumber.from(amountOutSmallestUnits.toString()),
    ]);

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

// --- Helper: Prepare V4 Multi-Hop Exact Input Swap Data ---
async function prepareV4MultiHopExactInSwapData(
    route: SwapRoute,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    chainId: number,
    networkMode: 'mainnet' | 'testnet'
): Promise<V4PlanBuild> {
    const inputToken = createTokenSDK(route.path[0] as TokenSymbol, chainId, networkMode);
    const outputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId, networkMode);
    if (!inputToken || !outputToken) {
        throw new Error(`Failed to create token instances for multi-hop route`);
    }

    // Build PoolKeys for each hop from config
    const poolKeys: PoolKey[] = [];
    for (let i = 0; i < route.pools.length; i++) {
        const hop = route.pools[i];
        const poolCfg = getPoolConfigForTokens(hop.token0, hop.token1, networkMode);
        if (!poolCfg) throw new Error(`Pool config not found for hop ${i}: ${hop.poolName}`);
        const poolKey = createPoolKeyFromConfig(poolCfg.pool);
        poolKeys.push(poolKey);
    }
    const pathKeys = encodeMultihopExactInPath(poolKeys, inputToken.address);

    const v4Planner = new V4Planner();

    // SWAP_EXACT_IN with PathKey[]
    v4Planner.addAction(Actions.SWAP_EXACT_IN, [
        {
            currencyIn: inputToken.address,
            path: pathKeys,
            amountIn: BigNumber.from(amountInSmallestUnits.toString()),
            amountOutMinimum: BigNumber.from(minAmountOutSmallestUnits.toString()),
        }
    ]);

    // SETTLE_ALL on true input currency (currencyIn)
    v4Planner.addAction(Actions.SETTLE_ALL, [
        inputToken.address,
        BigNumber.from(amountInSmallestUnits.toString()),
    ]);

    // TAKE_ALL on true output currency (final currencyOut)
    // For native ETH output, use a very low minimum (1 wei) to avoid precision issues
    // The SWAP action's amountOutMinimum already enforces the actual slippage protection
    const lastPoolKey = poolKeys[poolKeys.length - 1];
    const finalOutputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId, networkMode);
    if (!finalOutputToken) {
        throw new Error('Failed to create output token for TAKE_ALL');
    }
    // Determine which currency in the last pool is the output
    const outputCurrency = getAddress(finalOutputToken.address!) === lastPoolKey.currency0 
        ? lastPoolKey.currency0 
        : lastPoolKey.currency1;
    const isNativeOutput = outputCurrency === '0x0000000000000000000000000000000000000000';
    const takeAllMin = isNativeOutput ? 1n : (minAmountOutSmallestUnits * 95n) / 100n;
    
    v4Planner.addAction(Actions.TAKE_ALL, [
        outputCurrency,
        BigNumber.from(takeAllMin.toString()),
    ]);

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

// --- Helper: Prepare V4 Multi-Hop Exact Output Swap Data ---
async function prepareV4MultiHopExactOutSwapData(
    route: SwapRoute,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    chainId: number,
    networkMode: 'mainnet' | 'testnet'
): Promise<V4PlanBuild> {
    const inputToken = createTokenSDK(route.path[0] as TokenSymbol, chainId, networkMode);
    const outputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId, networkMode);

    if (!inputToken || !outputToken) {
        throw new Error(`Failed to create token instances for multi-hop route`);
    }

    const poolKeys: PoolKey[] = [];
    for (let i = 0; i < route.pools.length; i++) {
        const hop = route.pools[i];
        const poolCfg = getPoolConfigForTokens(hop.token0, hop.token1, networkMode);
        if (!poolCfg) {
            throw new Error(`Missing pool config for hop ${i}: ${hop.poolName}`);
        }
        const poolKey = createPoolKeyFromConfig(poolCfg.pool);
        poolKeys.push(poolKey);
    }

    const pathKeys = encodeMultihopExactOutPath(poolKeys, outputToken.address);

    const v4Planner = new V4Planner();

    v4Planner.addAction(Actions.SWAP_EXACT_OUT, [
        {
            currencyOut: outputToken.address,
            path: pathKeys,
            amountOut: BigNumber.from(amountOutSmallestUnits.toString()),
            amountInMaximum: BigNumber.from(maxAmountInSmallestUnits.toString()),
        }
    ]);

    v4Planner.addAction(Actions.SETTLE_ALL, [
        inputToken.address,
        BigNumber.from(maxAmountInSmallestUnits.toString()),
    ]);

    const isNativeOutput = outputToken.isNative;
    const takeAllMin = isNativeOutput ? 1n : (amountOutSmallestUnits * 95n) / 100n;

    v4Planner.addAction(Actions.TAKE_ALL, [
        outputToken.address,
        BigNumber.from(takeAllMin.toString()),
    ]);

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

interface BuildSwapTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        fromTokenSymbol: TokenSymbol;
        toTokenSymbol: TokenSymbol;
        swapType: 'ExactIn' | 'ExactOut';
        amountDecimalsStr: string;      // Amount to swap (input for ExactIn, output for ExactOut)
        limitAmountDecimalsStr: string; // Min output for ExactIn, Max input for ExactOut
        limitPrice?: string;            // Optional: V4 price limit for partial fills
        
        permitSignature: Hex;
        permitTokenAddress: string; // Address of the token that was permitted (INPUT_TOKEN)
        permitAmount: string;       // Amount (smallest units, string) that was permitted
        permitNonce: number;
        permitExpiration: number;   // Timestamp (seconds)
        permitSigDeadline: string;  // Timestamp (seconds, string for bigint)
        
        chainId: number;
    };
}

// Helper function to convert BigInts to strings recursively for JSON serialization
function jsonifyError(error: any): any {
    if (error === null || typeof error !== 'object') {
        return error;
    }

    if (error instanceof Error) {
        // Capture basic error properties and recursively process the cause if it exists
        const errorJson: Record<string, any> = {
            name: error.name,
            message: error.message,
            stack: error.stack, // Optional: include stack trace
        };
        if ('cause' in error) {
            errorJson.cause = jsonifyError((error as any).cause);
        }
         // Include shortMessage if it exists (common in Viem errors)
        if ('shortMessage' in error) {
           errorJson.shortMessage = (error as any).shortMessage;
        }
        // Include metaMessages if it exists (common in Viem errors)
        if ('metaMessages' in error) {
            errorJson.metaMessages = (error as any).metaMessages;
        }
        return errorJson;
    }
    
    if (Array.isArray(error)) {
        return error.map(jsonifyError);
    }

    const result: Record<string, any> = {};
    for (const key in error) {
        if (Object.prototype.hasOwnProperty.call(error, key)) {
            const value = error[key];
            if (typeof value === 'bigint') {
                result[key] = value.toString();
            } else if (typeof value === 'object') {
                result[key] = jsonifyError(value);
            } else {
                result[key] = value;
            }
        }
    }
    return result;
}

export default async function handler(req: BuildSwapTxRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ ok: false, message: `Method ${req.method} Not Allowed` });
    }

    // Rate limiting
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    const rateCheck = checkTxRateLimit(clientIp);
    if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
        return res.status(429).json({ ok: false, message: 'Too many requests. Please try again later.' });
    }

    try {
        const {
            userAddress,
            fromTokenSymbol,
            toTokenSymbol,
            swapType,
            amountDecimalsStr,
            limitAmountDecimalsStr,
            limitPrice,
            permitSignature,
            permitTokenAddress,
            permitAmount,
            permitNonce,
            permitExpiration,
            permitSigDeadline,
            chainId
        } = req.body;

        // Get network mode from cookies for proper chain-specific addresses
        const networkMode = getNetworkModeFromRequest(req.headers.cookie);

        // ChainId validation - CRITICAL security check
        const chainIdError = validateChainId(chainId, networkMode);
        if (chainIdError) {
            return res.status(400).json({ ok: false, message: chainIdError });
        }

        // Address validation
        const userAddrError = validateAddress(userAddress, 'userAddress');
        if (userAddrError) {
            return res.status(400).json({ ok: false, message: userAddrError });
        }
        const permitAddrError = fromTokenSymbol !== 'ETH' ? validateAddress(permitTokenAddress, 'permitTokenAddress') : null;
        if (permitAddrError) {
            return res.status(400).json({ ok: false, message: permitAddrError });
        }

        // Create network-specific public client
        const publicClient = createNetworkClient(networkMode);

        // Validate required fields (basic check)
        const requiredFields = [userAddress, fromTokenSymbol, toTokenSymbol, swapType, amountDecimalsStr, limitAmountDecimalsStr, permitSignature, permitTokenAddress, permitAmount, permitNonce, permitExpiration, permitSigDeadline, chainId];
        if (requiredFields.some(field => field === undefined || field === null)) {
            return res.status(400).json({ ok: false, message: 'Missing one or more required fields in request body.' });
        }
        if (fromTokenSymbol === toTokenSymbol) {
            return res.status(400).json({ ok: false, message: 'From and To tokens cannot be the same.' });
        }

        // Find the best route using the routing engine
        const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol, networkMode);
        
        if (!routeResult.bestRoute) {
            return res.status(400).json({ 
                ok: false,
                message: `No route found for token pair: ${fromTokenSymbol} → ${toTokenSymbol}`,
                error: 'No available pools to complete this swap'
            });
        }

        const route = routeResult.bestRoute;

        // For single-hop, we still need the pool config for backward compatibility
        let poolConfig: any = null;
        if (route.isDirectRoute) {
            poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol, networkMode);
            if (!poolConfig) {
                return res.status(400).json({ ok: false, message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
            }
        }

        const INPUT_TOKEN = createTokenSDK(fromTokenSymbol, chainId, networkMode);
        const OUTPUT_TOKEN = createTokenSDK(toTokenSymbol, chainId, networkMode);

        if (!INPUT_TOKEN || !OUTPUT_TOKEN) {
            return res.status(400).json({ ok: false, message: 'Failed to create token instances.' });
        }
        
        const parsedPermitAmount = BigInt(permitAmount);
        const parsedPermitSigDeadline = BigInt(permitSigDeadline);

        let amountInSmallestUnits: bigint;
        let amountOutSmallestUnits: bigint; // Used for ExactOut amount, or for minAmountOut in ExactIn
        let v4Plan: V4PlanBuild;

        const routePlanner = new RoutePlanner();

        // 1. Add PERMIT2_PERMIT command *only if* a valid signature is provided and it's not a native ETH swap
        if (fromTokenSymbol !== 'ETH' && permitSignature !== "0x") {
            // When submitting the permit command with a real signature,
            // the amount MUST match what was signed.
            routePlanner.addCommand(CommandType.PERMIT2_PERMIT, [
                [
                    [
                        getAddress(permitTokenAddress), // token
                        parsedPermitAmount,             // Use the actual signed amount
                        permitExpiration,               // expiration (number)
                        permitNonce                     // nonce (number)
                    ],
                    getUniversalRouterAddress(networkMode),        // spender
                    parsedPermitSigDeadline             // sigDeadline (bigint)
                ],
                permitSignature // The actual signature
            ]);
        }

        // 2. Prepare V4 Swap Data and add V4_SWAP command
        // Parse amounts according to swap type
        let actualSwapAmount: bigint; // ExactIn: amountIn; ExactOut: amountOut
        let actualLimitAmount: bigint; // ExactIn: minOut; ExactOut: maxIn
        if (swapType === 'ExactIn') {
            actualSwapAmount = safeParseUnits(amountDecimalsStr, INPUT_TOKEN.decimals);
            actualLimitAmount = safeParseUnits(limitAmountDecimalsStr, OUTPUT_TOKEN.decimals);
        } else {
            // ExactOut: amount is in OUTPUT token units; limit is max INPUT
            actualSwapAmount = safeParseUnits(amountDecimalsStr, OUTPUT_TOKEN.decimals);
            actualLimitAmount = safeParseUnits(limitAmountDecimalsStr, INPUT_TOKEN.decimals);
        }

        // Determine the value to send with the transaction (ETH input only)
        const txValue = fromTokenSymbol === 'ETH'
          ? (swapType === 'ExactIn' ? actualSwapAmount : actualLimitAmount)
          : 0n;

        if (swapType === 'ExactIn') {
            amountInSmallestUnits = actualSwapAmount; // Use the actual amount for the swap
            const minAmountOutSmallestUnits = actualLimitAmount;
            
            if (route.isDirectRoute) {
                // Single-hop swap using existing logic
                v4Plan = await prepareV4ExactInSwapData(
                    INPUT_TOKEN,
                    OUTPUT_TOKEN,
                    amountInSmallestUnits,
                    minAmountOutSmallestUnits,
                    poolConfig
                );
            } else {
                // Multi-hop swap using new logic
                v4Plan = await prepareV4MultiHopExactInSwapData(
                    route,
                    amountInSmallestUnits,
                    minAmountOutSmallestUnits,
                    chainId,
                    networkMode
                );
            }
        } else { // ExactOut
            amountOutSmallestUnits = actualSwapAmount; // amountOut in OUTPUT token units
            const maxAmountInSmallestUnits = actualLimitAmount; // max INPUT limit
            
            if (route.isDirectRoute) {
                // Single-hop swap using existing logic
                v4Plan = await prepareV4ExactOutSwapData(
                    INPUT_TOKEN,
                    OUTPUT_TOKEN,
                    maxAmountInSmallestUnits, // Max Input is the limit amount
                    amountOutSmallestUnits, // Actual output amount
                    poolConfig,
                    limitPrice
                );
            } else {
                // Multi-hop swap using new logic
                v4Plan = await prepareV4MultiHopExactOutSwapData(
                    route,
                    maxAmountInSmallestUnits,
                    amountOutSmallestUnits,
                    chainId,
                    networkMode
                );
            }
        }
        const encodedActions = v4Plan.encodedActions;
        routePlanner.addCommand(CommandType.V4_SWAP, [encodedActions]);

        // 3. Calculate Transaction Deadline
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const txDeadline = currentTimestamp + BigInt(TX_DEADLINE_SECONDS);

        // 4. Simulate Transaction
        await publicClient.simulateContract({
            account: getAddress(userAddress), // Simulate as if the user is sending
            address: getUniversalRouterAddress(networkMode),
            abi: UniversalRouterAbi, // Ensure UniversalRouterAbi is correctly typed as Abi
            functionName: 'execute',
            args: [routePlanner.commands as Hex, routePlanner.inputs as Hex[], txDeadline],
            value: txValue,
        });

        // Derive touched pools (friendly poolId and subgraphId) for downstream cache invalidation
        const touchedPools: Array<{ poolId: string; subgraphId?: string }> = [];
        try {
            if (route.isDirectRoute) {
                const poolCfg = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol, networkMode);
                if (poolCfg) {
                    touchedPools.push({ poolId: poolCfg.pool.id, subgraphId: poolCfg.pool.subgraphId || poolCfg.pool.id });
                }
            } else {
                for (const hop of route.pools) {
                    const cfg = getPoolConfigForTokens(hop.token0 as TokenSymbol, hop.token1 as TokenSymbol, networkMode);
                    if (cfg) touchedPools.push({ poolId: cfg.pool.id, subgraphId: cfg.pool.subgraphId || cfg.pool.id });
                }
            }
        } catch {}

        // Transaction building is real-time - never cache (Uniswap pattern)
        res.setHeader('Cache-Control', 'no-store');

        res.status(200).json({
            ok: true,
            commands: routePlanner.commands as Hex,
            inputs: routePlanner.inputs as Hex[],
            deadline: txDeadline.toString(),
            to: getUniversalRouterAddress(networkMode),
            value: txValue.toString(),
            route: {
                path: route.path,
                hops: route.hops,
                isDirectRoute: route.isDirectRoute,
                pools: route.pools.map(pool => pool.poolName)
            },
            limitPrice: limitPrice || null,
            touchedPools
        });

    } catch (error: any) {
        console.error("Error in /api/swap/build-tx:", error);

        // Extract a user-friendly message
        let errorMessage = "Failed to build transaction.";
        if (error instanceof TransactionExecutionError) {
             // Prefer shortMessage if available, otherwise use the main message
            errorMessage = error.shortMessage || error.message || errorMessage;
        } else if (error instanceof Error) {
            errorMessage = error.message || errorMessage;
        }
        
        // Use the helper function to serialize the error safely
        const safeErrorJson = jsonifyError(error);

        res.status(500).json({
            ok: false,
            message: errorMessage,
            // error: error // Consider sending a less verbose error in production
            errorDetails: safeErrorJson // Send the sanitized error details
        });
    }
} 