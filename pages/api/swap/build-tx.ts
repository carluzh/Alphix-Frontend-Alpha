import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseUnits, encodeFunctionData, type Address, type Hex, type Abi, TransactionExecutionError } from 'viem';
import { Token } from '@uniswap/sdk-core';
import { RoutePlanner, CommandType } from '@uniswap/universal-router-sdk';
import { Pool, Route as V4Route, PoolKey, V4Planner, Actions, encodeRouteToPath } from '@uniswap/v4-sdk';
import { BigNumber } from 'ethers'; // For V4Planner compatibility if it expects Ethers BigNumber

import { publicClient } from '../../../lib/viemClient';
import {
    TokenSymbol,
    getPoolConfigForTokens,
    createTokenSDK,
    createPoolKeyFromConfig,
    CHAIN_ID as DEFAULT_CHAIN_ID
} from '../../../lib/pools-config';
import {
    UNIVERSAL_ROUTER_ADDRESS,
    UniversalRouterAbi,
    TX_DEADLINE_SECONDS
} from '../../../lib/swap-constants';
import { findBestRoute, SwapRoute, routeToString } from '../../../lib/routing-engine';

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

// --- Helper: Prepare V4 Exact Input Swap Data (Adapted from original swap.ts) ---
// This function can be kept within this file or moved to a separate utility if it grows.
async function prepareV4ExactInSwapData(
    inputToken: Token,
    outputToken: Token,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    poolConfig: any,
    limitPrice?: string
): Promise<Hex> {
    const token0ForV4 = inputToken.sortsBefore(outputToken) ? inputToken : outputToken;
    const token1ForV4 = inputToken.sortsBefore(outputToken) ? outputToken : inputToken;
    
    const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig.pool);
    console.log("V4 Pool Key (Exact In):", v4PoolKey);
    const poolIdExactIn = Pool.getPoolId(token0ForV4, token1ForV4, v4PoolKey.fee, v4PoolKey.tickSpacing, v4PoolKey.hooks);
    console.log("V4 Pool ID (Exact In):", poolIdExactIn);

    const v4Planner = new V4Planner();
    v4Planner.addSettle(inputToken, true, BigNumber.from(amountInSmallestUnits.toString())); 
    
    const placeholderSqrtPriceX96 = (1n << 96n); 
    const placeholderLiquidity = '1000000000000000000';
    const placeholderTick = 0;

    const dummyV4PoolForRoute = new Pool(
        token0ForV4, token1ForV4, v4PoolKey.fee, v4PoolKey.tickSpacing, v4PoolKey.hooks,
        placeholderSqrtPriceX96.toString(), placeholderLiquidity, placeholderTick
    );
    const singleHopV4Route = new V4Route([dummyV4PoolForRoute], inputToken, outputToken);
    const encodedV4Path = encodeRouteToPath(singleHopV4Route, false); // false for exactIn

    // Calculate price limit if provided
    let sqrtPriceLimitX96 = 0n; // 0 means no limit
    let adjustedMinAmountOut = minAmountOutSmallestUnits; // Default to provided value
    
    if (limitPrice && limitPrice !== "" && parseFloat(limitPrice) > 0) {
        const zeroForOne = determineSwapDirection(inputToken, outputToken);
        sqrtPriceLimitX96 = calculatePriceLimitX96(limitPrice, inputToken, outputToken, zeroForOne);
        
        // For limit orders, we want to allow partial fills and let sqrtPriceLimitX96 control the execution
        // Set amountOutMinimum to a very small value to avoid slippage reverts
        // The price limit will stop the swap when appropriate, allowing partial fills
        adjustedMinAmountOut = 1n; // Minimal amount to avoid division by zero, but allow partial fills
        
        console.log(`🔧 [PRICE LIMIT DEBUG] Input limitPrice: "${limitPrice}"`);
        console.log(`🔧 [PRICE LIMIT DEBUG] Swap direction zeroForOne: ${zeroForOne}`);
        console.log(`🔧 [PRICE LIMIT DEBUG] Input token: ${inputToken.symbol} (${inputToken.address})`);
        console.log(`🔧 [PRICE LIMIT DEBUG] Output token: ${outputToken.symbol} (${outputToken.address})`);
        console.log(`🔧 [PRICE LIMIT DEBUG] Amount in: ${amountInSmallestUnits.toString()}`);
        console.log(`🔧 [PRICE LIMIT DEBUG] Original minAmountOut: ${minAmountOutSmallestUnits.toString()}`);
        console.log(`🔧 [PRICE LIMIT DEBUG] Adjusted to minimal minAmountOut for partial fills: ${adjustedMinAmountOut.toString()}`);
        console.log(`🔧 [PRICE LIMIT DEBUG] Calculated sqrtPriceLimitX96: ${sqrtPriceLimitX96.toString()}`);
        console.log(`V4 Price Limit: ${limitPrice} -> sqrtPriceLimitX96: ${sqrtPriceLimitX96.toString()}`);
    } else {
        console.log(`🔧 [PRICE LIMIT DEBUG] No price limit provided or invalid value: "${limitPrice}"`);
    }

    // Updated V4 action parameters to include sqrtPriceLimitX96
    const swapAction = {
        currencyIn: getAddress(inputToken.address),
        path: encodedV4Path, 
        amountIn: 0, 
        amountOutMinimum: adjustedMinAmountOut.toString(),
        sqrtPriceLimitX96: sqrtPriceLimitX96.toString()
    };
    
    console.log(`🔧 [SWAP ACTION DEBUG] Final swap action object:`, JSON.stringify(swapAction, null, 2));
    
    v4Planner.addAction(Actions.SWAP_EXACT_IN, [swapAction]);
    v4Planner.addTake(outputToken, "0x0000000000000000000000000000000000000001" as Address);
    return v4Planner.finalize() as Hex;
}

// --- Helper: Prepare V4 Exact Output Swap Data (Adapted) ---
async function prepareV4ExactOutSwapData(
    inputToken: Token,
    outputToken: Token,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    poolConfig: any,
    limitPrice?: string
): Promise<Hex> {
    const token0ForV4 = inputToken.sortsBefore(outputToken) ? inputToken : outputToken;
    const token1ForV4 = inputToken.sortsBefore(outputToken) ? outputToken : inputToken;
    
    const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig.pool);
    console.log("V4 Pool Key (Exact Out):", v4PoolKey);
    const poolIdExactOut = Pool.getPoolId(token0ForV4, token1ForV4, v4PoolKey.fee, v4PoolKey.tickSpacing, v4PoolKey.hooks);
    console.log("V4 Pool ID (Exact Out):", poolIdExactOut);

    const placeholderSqrtPriceX96 = (1n << 96n); 
    const placeholderLiquidity = '100000000000000000000'; 
    const placeholderTick = 0;

    const dummyV4PoolForRoute = new Pool(
        token0ForV4, token1ForV4, v4PoolKey.fee, v4PoolKey.tickSpacing, v4PoolKey.hooks,
        placeholderSqrtPriceX96.toString(), placeholderLiquidity, placeholderTick
    );
    const route = new V4Route([dummyV4PoolForRoute], inputToken, outputToken);
    const encodedV4Path = encodeRouteToPath(route, true); // true for exactOutput

    const v4Planner = new V4Planner();
    v4Planner.addSettle(inputToken, true, BigNumber.from(maxAmountInSmallestUnits.toString())); 
    
    // Calculate price limit if provided
    let sqrtPriceLimitX96 = 0n; // 0 means no limit
    if (limitPrice && limitPrice !== "" && parseFloat(limitPrice) > 0) {
        const zeroForOne = determineSwapDirection(inputToken, outputToken);
        sqrtPriceLimitX96 = calculatePriceLimitX96(limitPrice, inputToken, outputToken, zeroForOne);
        console.log(`🔧 [EXACT OUT PRICE LIMIT DEBUG] Input limitPrice: "${limitPrice}"`);
        console.log(`🔧 [EXACT OUT PRICE LIMIT DEBUG] Swap direction zeroForOne: ${zeroForOne}`);
        console.log(`🔧 [EXACT OUT PRICE LIMIT DEBUG] Input token: ${inputToken.symbol} (${inputToken.address})`);
        console.log(`🔧 [EXACT OUT PRICE LIMIT DEBUG] Output token: ${outputToken.symbol} (${outputToken.address})`);
        console.log(`🔧 [EXACT OUT PRICE LIMIT DEBUG] Calculated sqrtPriceLimitX96: ${sqrtPriceLimitX96.toString()}`);
        console.log(`V4 Price Limit (Exact Out): ${limitPrice} -> sqrtPriceLimitX96: ${sqrtPriceLimitX96.toString()}`);
    } else {
        console.log(`🔧 [EXACT OUT PRICE LIMIT DEBUG] No price limit provided or invalid value: "${limitPrice}"`);
    }
    
    const swapAction = {
        currencyOut: getAddress(outputToken.address),
        path: encodedV4Path,
        amountOut: amountOutSmallestUnits.toString(),
        amountInMaximum: maxAmountInSmallestUnits.toString(),
        sqrtPriceLimitX96: sqrtPriceLimitX96.toString()
    };
    
    console.log(`🔧 [EXACT OUT SWAP ACTION DEBUG] Final swap action object:`, JSON.stringify(swapAction, null, 2));
    
    v4Planner.addAction(Actions.SWAP_EXACT_OUT, [swapAction]);
    v4Planner.addTake(outputToken, "0x0000000000000000000000000000000000000001" as Address); // Send to msg.sender of UR
    v4Planner.addTake(inputToken, "0x0000000000000000000000000000000000000001" as Address); // Refund remaining input to msg.sender
    
    return v4Planner.finalize() as Hex;
}

// --- Helper: Prepare V4 Multi-Hop Exact Input Swap Data ---
async function prepareV4MultiHopExactInSwapData(
    route: SwapRoute,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    chainId: number,
    limitPrice?: string
): Promise<Hex> {
    const inputToken = createTokenSDK(route.path[0] as TokenSymbol, chainId);
    const outputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId);
    
    if (!inputToken || !outputToken) {
        throw new Error(`Failed to create token instances for multi-hop route`);
    }

    console.log("V4 Multi-Hop Route (Exact In):", routeToString(route));

    // Create V4Planner for multi-hop
    const v4Planner = new V4Planner();
    v4Planner.addSettle(inputToken, true, BigNumber.from(amountInSmallestUnits.toString()));

    // Build the encoded path for multi-hop
    const pools: Pool[] = [];
    for (let i = 0; i < route.pools.length; i++) {
        const poolHop = route.pools[i];
        const token0 = createTokenSDK(poolHop.token0 as TokenSymbol, chainId);
        const token1 = createTokenSDK(poolHop.token1 as TokenSymbol, chainId);
        
        if (!token0 || !token1) {
            throw new Error(`Failed to create token instances for pool ${poolHop.poolName}`);
        }

        // Create sorted tokens for the pool
        const sortedToken0 = token0.sortsBefore(token1) ? token0 : token1;
        const sortedToken1 = token0.sortsBefore(token1) ? token1 : token0;

        // Create dummy pool for path encoding
        const placeholderSqrtPriceX96 = (1n << 96n);
        const placeholderLiquidity = '1000000000000000000';
        const placeholderTick = 0;

        const dummyPool = new Pool(
            sortedToken0, sortedToken1, poolHop.fee, poolHop.tickSpacing, poolHop.hooks as Hex,
            placeholderSqrtPriceX96.toString(), placeholderLiquidity, placeholderTick
        );
        pools.push(dummyPool);
    }

    // Create multi-hop route
    const multiHopRoute = new V4Route(pools, inputToken, outputToken);
    const encodedV4Path = encodeRouteToPath(multiHopRoute, false); // false for exactIn

    // Calculate price limit if provided (only applies to the final hop in multi-hop)
    let sqrtPriceLimitX96 = 0n; // 0 means no limit
    if (limitPrice && limitPrice !== "" && parseFloat(limitPrice) > 0) {
        // For multi-hop, the price limit applies to the overall trade
        // Note: This is a simplified implementation - in production you might want more sophisticated logic
        const zeroForOne = determineSwapDirection(inputToken, outputToken);
        sqrtPriceLimitX96 = calculatePriceLimitX96(limitPrice, inputToken, outputToken, zeroForOne);
        console.log(`V4 Multi-Hop Price Limit: ${limitPrice} -> sqrtPriceLimitX96: ${sqrtPriceLimitX96.toString()}`);
    }

    v4Planner.addAction(Actions.SWAP_EXACT_IN, [{
        currencyIn: getAddress(inputToken.address),
        path: encodedV4Path,
        amountIn: 0,
        amountOutMinimum: minAmountOutSmallestUnits.toString(),
        sqrtPriceLimitX96: sqrtPriceLimitX96.toString()
    }]);
    v4Planner.addTake(outputToken, "0x0000000000000000000000000000000000000001" as Address);
    
    return v4Planner.finalize() as Hex;
}

// --- Helper: Prepare V4 Multi-Hop Exact Output Swap Data ---
async function prepareV4MultiHopExactOutSwapData(
    route: SwapRoute,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    chainId: number,
    limitPrice?: string
): Promise<Hex> {
    const inputToken = createTokenSDK(route.path[0] as TokenSymbol, chainId);
    const outputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId);
    
    if (!inputToken || !outputToken) {
        throw new Error(`Failed to create token instances for multi-hop route`);
    }

    console.log("V4 Multi-Hop Route (Exact Out):", routeToString(route));

    // Create V4Planner for multi-hop
    const v4Planner = new V4Planner();
    v4Planner.addSettle(inputToken, true, BigNumber.from(maxAmountInSmallestUnits.toString()));

    // Build the encoded path for multi-hop
    const pools: Pool[] = [];
    for (let i = 0; i < route.pools.length; i++) {
        const poolHop = route.pools[i];
        const token0 = createTokenSDK(poolHop.token0 as TokenSymbol, chainId);
        const token1 = createTokenSDK(poolHop.token1 as TokenSymbol, chainId);
        
        if (!token0 || !token1) {
            throw new Error(`Failed to create token instances for pool ${poolHop.poolName}`);
        }

        // Create sorted tokens for the pool
        const sortedToken0 = token0.sortsBefore(token1) ? token0 : token1;
        const sortedToken1 = token0.sortsBefore(token1) ? token1 : token0;

        // Create dummy pool for path encoding
        const placeholderSqrtPriceX96 = (1n << 96n);
        const placeholderLiquidity = '100000000000000000000';
        const placeholderTick = 0;

        const dummyPool = new Pool(
            sortedToken0, sortedToken1, poolHop.fee, poolHop.tickSpacing, poolHop.hooks as Hex,
            placeholderSqrtPriceX96.toString(), placeholderLiquidity, placeholderTick
        );
        pools.push(dummyPool);
    }

    // Create multi-hop route
    const multiHopRoute = new V4Route(pools, inputToken, outputToken);
    const encodedV4Path = encodeRouteToPath(multiHopRoute, true); // true for exactOutput

    // Calculate price limit if provided
    let sqrtPriceLimitX96 = 0n; // 0 means no limit
    if (limitPrice && limitPrice !== "" && parseFloat(limitPrice) > 0) {
        const zeroForOne = determineSwapDirection(inputToken, outputToken);
        sqrtPriceLimitX96 = calculatePriceLimitX96(limitPrice, inputToken, outputToken, zeroForOne);
        console.log(`V4 Multi-Hop Price Limit (Exact Out): ${limitPrice} -> sqrtPriceLimitX96: ${sqrtPriceLimitX96.toString()}`);
    }

    v4Planner.addAction(Actions.SWAP_EXACT_OUT, [{
        currencyOut: getAddress(outputToken.address),
        path: encodedV4Path,
        amountOut: amountOutSmallestUnits.toString(),
        amountInMaximum: maxAmountInSmallestUnits.toString(),
        sqrtPriceLimitX96: sqrtPriceLimitX96.toString()
    }]);
    v4Planner.addTake(outputToken, "0x0000000000000000000000000000000000000001" as Address);
    v4Planner.addTake(inputToken, "0x0000000000000000000000000000000000000001" as Address);
    
    return v4Planner.finalize() as Hex;
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

        // Validate required fields (basic check)
        const requiredFields = [userAddress, fromTokenSymbol, toTokenSymbol, swapType, amountDecimalsStr, limitAmountDecimalsStr, permitSignature, permitTokenAddress, permitAmount, permitNonce, permitExpiration, permitSigDeadline, chainId];
        if (requiredFields.some(field => field === undefined || field === null)) {
            return res.status(400).json({ ok: false, message: 'Missing one or more required fields in request body.' });
        }
        if (fromTokenSymbol === toTokenSymbol) {
            return res.status(400).json({ ok: false, message: 'From and To tokens cannot be the same.' });
        }

        // Find the best route using the routing engine
        const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol);
        
        if (!routeResult.bestRoute) {
            return res.status(400).json({ 
                ok: false,
                message: `No route found for token pair: ${fromTokenSymbol} → ${toTokenSymbol}`,
                error: 'No available pools to complete this swap'
            });
        }

        const route = routeResult.bestRoute;
        console.log(`[Build-Tx] Using route: ${routeToString(route)}`);
        
        // For single-hop, we still need the pool config for backward compatibility
        let poolConfig: any = null;
        if (route.isDirectRoute) {
            poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol);
            if (!poolConfig) {
                return res.status(400).json({ ok: false, message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
            }
        }

        const INPUT_TOKEN = createTokenSDK(fromTokenSymbol, chainId);
        const OUTPUT_TOKEN = createTokenSDK(toTokenSymbol, chainId);

        if (!INPUT_TOKEN || !OUTPUT_TOKEN) {
            return res.status(400).json({ ok: false, message: 'Failed to create token instances.' });
        }
        
        const parsedPermitAmount = BigInt(permitAmount);
        const parsedPermitSigDeadline = BigInt(permitSigDeadline);

        let amountInSmallestUnits: bigint;
        let amountOutSmallestUnits: bigint; // Used for ExactOut amount, or for minAmountOut in ExactIn
        let v4ActionsByteString: Hex;

        const routePlanner = new RoutePlanner();

        // 1. Add PERMIT2_PERMIT command *only if* a valid signature is provided
        if (permitSignature !== "0x") {
            // When submitting the permit command with a real signature,
            // the amount MUST match what was signed.
            routePlanner.addCommand(CommandType.PERMIT2_PERMIT, [
                [
                    [
                        getAddress(permitTokenAddress), // token
                        // Use MaxUint160 because that's what the user signed
                        MaxUint160,                     
                        permitExpiration,               // expiration (number)
                        permitNonce                     // nonce (number)
                    ],
                    UNIVERSAL_ROUTER_ADDRESS,           // spender
                    parsedPermitSigDeadline             // sigDeadline (bigint)
                ],
                permitSignature // The actual signature
            ]);
        } // Otherwise, if signature is "0x", we skip adding the permit command and rely on the existing allowance.

        // 2. Prepare V4 Swap Data and add V4_SWAP command
        // Use the actual swap amount (parsedPermitAmount or amountDecimalsStr) for swap logic
        const actualSwapAmount = parseUnits(amountDecimalsStr, INPUT_TOKEN.decimals); 
        const actualLimitAmount = parseUnits(limitAmountDecimalsStr, OUTPUT_TOKEN.decimals); // Assuming ExactIn for limit parsing

        // Optional: Add a check here if needed, comparing actualSwapAmount to parsedPermitAmount if that was intended

        if (swapType === 'ExactIn') {
            amountInSmallestUnits = actualSwapAmount; // Use the actual amount for the swap
            const minAmountOutSmallestUnits = actualLimitAmount;
            
            if (route.isDirectRoute) {
                // Single-hop swap using existing logic
                v4ActionsByteString = await prepareV4ExactInSwapData(
                    INPUT_TOKEN,
                    OUTPUT_TOKEN,
                    amountInSmallestUnits,
                    minAmountOutSmallestUnits,
                    poolConfig,
                    limitPrice
                );
            } else {
                // Multi-hop swap using new logic
                v4ActionsByteString = await prepareV4MultiHopExactInSwapData(
                    route,
                    amountInSmallestUnits,
                    minAmountOutSmallestUnits,
                    chainId,
                    limitPrice
                );
            }
        } else { // ExactOut
            amountOutSmallestUnits = actualSwapAmount; // Use the actual amount for the swap output
            const maxAmountInSmallestUnits = actualLimitAmount; // Limit is max input here
            
            if (route.isDirectRoute) {
                // Single-hop swap using existing logic
                v4ActionsByteString = await prepareV4ExactOutSwapData(
                    INPUT_TOKEN,
                    OUTPUT_TOKEN,
                    maxAmountInSmallestUnits, // Max Input is the limit amount
                    amountOutSmallestUnits, // Actual output amount
                    poolConfig,
                    limitPrice
                );
            } else {
                // Multi-hop swap using new logic
                v4ActionsByteString = await prepareV4MultiHopExactOutSwapData(
                    route,
                    maxAmountInSmallestUnits,
                    amountOutSmallestUnits,
                    chainId,
                    limitPrice
                );
            }
        }
        routePlanner.addCommand(CommandType.V4_SWAP, [v4ActionsByteString]);

        // 3. Calculate Transaction Deadline
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const txDeadline = currentTimestamp + BigInt(TX_DEADLINE_SECONDS);

        // 4. Simulate Transaction
        const { request: simulateRequest, result: simulateResult } = await publicClient.simulateContract({
            account: getAddress(userAddress), // Simulate as if the user is sending
            address: UNIVERSAL_ROUTER_ADDRESS,
            abi: UniversalRouterAbi, // Ensure UniversalRouterAbi is correctly typed as Abi
            functionName: 'execute',
            args: [routePlanner.commands as Hex, routePlanner.inputs as Hex[], txDeadline],
            value: 0n, // Assuming no ETH value sent with swap
        });
        // console.log("Transaction simulation successful:", simulateResult);

        res.status(200).json({
            ok: true,
            commands: routePlanner.commands as Hex,
            inputs: routePlanner.inputs as Hex[],
            deadline: txDeadline.toString(),
            to: UNIVERSAL_ROUTER_ADDRESS,
            value: '0', // Assuming no ETH is sent with the swap
            route: {
                path: route.path,
                hops: route.hops,
                isDirectRoute: route.isDirectRoute,
                pools: route.pools.map(pool => pool.poolName)
            },
            limitPrice: limitPrice || null // Echo back the limit price for confirmation
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