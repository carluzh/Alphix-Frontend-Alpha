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
const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff'); // 2**160 - 1

// --- Helper: Prepare V4 Exact Input Swap Data (Adapted from original swap.ts) ---
// This function can be kept within this file or moved to a separate utility if it grows.
async function prepareV4ExactInSwapData(
    inputToken: Token,
    outputToken: Token,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    poolConfig: any
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

    v4Planner.addAction(Actions.SWAP_EXACT_IN, [{
        currencyIn: getAddress(inputToken.address),
        path: encodedV4Path, 
        amountIn: 0, 
        amountOutMinimum: minAmountOutSmallestUnits.toString()
    }]);
    v4Planner.addTake(outputToken, "0x0000000000000000000000000000000000000001" as Address);
    return v4Planner.finalize() as Hex;
}

// --- Helper: Prepare V4 Exact Output Swap Data (Adapted) ---
async function prepareV4ExactOutSwapData(
    inputToken: Token,
    outputToken: Token,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    poolConfig: any
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
    v4Planner.addAction(Actions.SWAP_EXACT_OUT, [{
        currencyOut: getAddress(outputToken.address),
        path: encodedV4Path,
        amountOut: amountOutSmallestUnits.toString(),
        amountInMaximum: maxAmountInSmallestUnits.toString() 
    }]);
    v4Planner.addTake(outputToken, "0x0000000000000000000000000000000000000001" as Address); // Send to msg.sender of UR
    v4Planner.addTake(inputToken, "0x0000000000000000000000000000000000000001" as Address); // Refund remaining input to msg.sender
    
    return v4Planner.finalize() as Hex;
}

// --- Helper: Prepare V4 Multi-Hop Exact Input Swap Data ---
async function prepareV4MultiHopExactInSwapData(
    route: SwapRoute,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    chainId: number
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

    v4Planner.addAction(Actions.SWAP_EXACT_IN, [{
        currencyIn: getAddress(inputToken.address),
        path: encodedV4Path,
        amountIn: 0,
        amountOutMinimum: minAmountOutSmallestUnits.toString()
    }]);
    v4Planner.addTake(outputToken, "0x0000000000000000000000000000000000000001" as Address);
    
    return v4Planner.finalize() as Hex;
}

// --- Helper: Prepare V4 Multi-Hop Exact Output Swap Data ---
async function prepareV4MultiHopExactOutSwapData(
    route: SwapRoute,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    chainId: number
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

    v4Planner.addAction(Actions.SWAP_EXACT_OUT, [{
        currencyOut: getAddress(outputToken.address),
        path: encodedV4Path,
        amountOut: amountOutSmallestUnits.toString(),
        amountInMaximum: maxAmountInSmallestUnits.toString()
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
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const {
            userAddress,
            fromTokenSymbol,
            toTokenSymbol,
            swapType,
            amountDecimalsStr,
            limitAmountDecimalsStr,
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
            return res.status(400).json({ message: 'Missing one or more required fields in request body.' });
        }
        if (fromTokenSymbol === toTokenSymbol) {
            return res.status(400).json({ message: 'From and To tokens cannot be the same.' });
        }

        // Find the best route using the routing engine
        const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol);
        
        if (!routeResult.bestRoute) {
            return res.status(400).json({ 
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
                return res.status(400).json({ message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
            }
        }

        const INPUT_TOKEN = createTokenSDK(fromTokenSymbol, chainId);
        const OUTPUT_TOKEN = createTokenSDK(toTokenSymbol, chainId);

        if (!INPUT_TOKEN || !OUTPUT_TOKEN) {
            return res.status(400).json({ message: 'Failed to create token instances.' });
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
                    poolConfig
                );
            } else {
                // Multi-hop swap using new logic
                v4ActionsByteString = await prepareV4MultiHopExactInSwapData(
                    route,
                    amountInSmallestUnits,
                    minAmountOutSmallestUnits,
                    chainId
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
                    poolConfig
                );
            } else {
                // Multi-hop swap using new logic
                v4ActionsByteString = await prepareV4MultiHopExactOutSwapData(
                    route,
                    maxAmountInSmallestUnits,
                    amountOutSmallestUnits,
                    chainId
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
            }
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
            message: errorMessage,
            // error: error // Consider sending a less verbose error in production
            errorDetails: safeErrorJson // Send the sanitized error details
        });
    }
} 