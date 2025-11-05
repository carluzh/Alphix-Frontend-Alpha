/**
 * API endpoint for calculating optimal swap amounts for zapping
 * This performs the binary search to find the best swap amount
 * Returns the swap details that will be used for the actual transactions
 */

import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import { nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getQuoterAddress, getPoolByTokens, getStateViewAddress } from "../../../lib/pools-config";
import { V4_QUOTER_ABI_STRINGS, EMPTY_BYTES } from "../../../lib/swap-constants";

import { publicClient } from "../../../lib/viemClient";
import {
    getAddress,
    parseAbi,
    parseUnits,
    formatUnits,
} from "viem";

const QUOTER_ADDRESS = getQuoterAddress();
const STATE_VIEW_ADDRESS = getStateViewAddress();

interface CalculateZapAmountsRequest extends NextApiRequest {
    body: {
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        inputAmount: string;
        inputTokenSymbol: TokenSymbol;
        userTickLower: number;
        userTickUpper: number;
        chainId: number;
        slippageTolerance?: number;
    };
}

interface CalculateZapAmountsResponse {
    optimalSwapAmount: string;
    minSwapOutput: string;
    expectedToken0Amount: string;
    expectedToken1Amount: string;
    expectedLiquidity: string;
    swapDirection: {
        from: TokenSymbol;
        to: TokenSymbol;
    };
    priceImpact: string;
    // Leftover amounts that won't be used in the position
    leftoverToken0?: string;
    leftoverToken1?: string;
}

// Helper to get swap quote from V4 Quoter
async function getSwapQuote(
    fromToken: Token,
    toToken: Token,
    amountIn: bigint,
    poolConfig: any
): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
    const zeroForOne = fromToken.sortsBefore(toToken);
    const [sortedToken0, sortedToken1] = fromToken.sortsBefore(toToken)
        ? [fromToken, toToken]
        : [toToken, fromToken];

    const poolKey = {
        currency0: getAddress(sortedToken0.address),
        currency1: getAddress(sortedToken1.address),
        fee: poolConfig.fee,
        tickSpacing: poolConfig.tickSpacing,
        hooks: getAddress(poolConfig.hooks)
    };

    const quoteParams = [
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        zeroForOne,
        amountIn,
        EMPTY_BYTES
    ] as const;

    try {
        const [amountOut, gasEstimate] = await publicClient.readContract({
            address: QUOTER_ADDRESS,
            abi: parseAbi(V4_QUOTER_ABI_STRINGS),
            functionName: 'quoteExactInputSingle',
            args: [quoteParams]
        }) as readonly [bigint, bigint];

        return { amountOut, gasEstimate };
    } catch (error) {
        console.error("Error getting swap quote:", error);
        throw error;
    }
}

// Calculate optimal swap amount using binary search
async function calculateOptimalSwapAmount(
    inputToken: Token,
    otherToken: Token,
    inputAmount: bigint,
    tickLower: number,
    tickUpper: number,
    poolConfig: any,
    v4Pool: V4Pool
): Promise<{ optimalSwapAmount: bigint; resultingPosition: V4Position }> {

    // For out-of-range positions, handle differently
    const currentTick = v4Pool.tickCurrent;
    const isOutOfRange = currentTick < tickLower || currentTick > tickUpper;

    if (isOutOfRange) {
        // Determine which token is needed based on position relative to current tick
        const needsToken0Only = currentTick >= tickUpper;
        const needsToken1Only = currentTick <= tickLower;

        const inputIsToken0 = inputToken.sortsBefore(otherToken);

        // If we have the wrong token for an OOR position, we need to swap all of it
        if ((needsToken0Only && !inputIsToken0) || (needsToken1Only && inputIsToken0)) {
            // Swap all input to the needed token
            const swapQuote = await getSwapQuote(inputToken, otherToken, inputAmount, poolConfig);

            // Create position with the swapped amount
            let position: V4Position;
            if (needsToken0Only) {
                position = V4Position.fromAmount0({
                    pool: v4Pool,
                    tickLower,
                    tickUpper,
                    amount0: JSBI.BigInt(swapQuote.amountOut.toString()),
                    useFullPrecision: true
                });
            } else {
                position = V4Position.fromAmount1({
                    pool: v4Pool,
                    tickLower,
                    tickUpper,
                    amount1: JSBI.BigInt(swapQuote.amountOut.toString())
                });
            }

            return { optimalSwapAmount: inputAmount, resultingPosition: position };
        } else {
            // We have the correct token for OOR, no swap needed
            let position: V4Position;
            if (inputIsToken0) {
                position = V4Position.fromAmount0({
                    pool: v4Pool,
                    tickLower,
                    tickUpper,
                    amount0: JSBI.BigInt(inputAmount.toString()),
                    useFullPrecision: true
                });
            } else {
                position = V4Position.fromAmount1({
                    pool: v4Pool,
                    tickLower,
                    tickUpper,
                    amount1: JSBI.BigInt(inputAmount.toString())
                });
            }

            return { optimalSwapAmount: 0n, resultingPosition: position };
        }
    }

    // For in-range positions, use binary search to find optimal swap amount
    let low = 0n;
    let high = inputAmount;
    let bestSwapAmount = 0n;
    let bestPosition: V4Position | null = null;
    let maxLiquidity = JSBI.BigInt(0);

    // Reduced iterations for speed (7 iterations = 128 steps precision, ~0.8% accuracy)
    const iterations = 7;
    const inputIsToken0 = inputToken.sortsBefore(otherToken);

    for (let i = 0; i < iterations; i++) {
        const mid = (low + high) / 2n;

        // Skip if mid is 0 on first iteration
        if (mid === 0n && i > 0) break;

        try {
            // Get quote for swapping 'mid' amount
            const swapQuote = mid > 0n
                ? await getSwapQuote(inputToken, otherToken, mid, poolConfig)
                : { amountOut: 0n, gasEstimate: 0n };

            // Calculate remaining amounts after swap
            const remainingInput = inputAmount - mid;
            const receivedOther = swapQuote.amountOut;

            // Determine which amount is token0 and which is token1
            const amount0 = inputIsToken0 ? remainingInput : receivedOther;
            const amount1 = inputIsToken0 ? receivedOther : remainingInput;

            // Create position from these amounts
            const position = V4Position.fromAmounts({
                pool: v4Pool,
                tickLower,
                tickUpper,
                amount0: amount0.toString(),
                amount1: amount1.toString(),
                useFullPrecision: true
            });

            const liquidity = JSBI.BigInt(position.liquidity.toString());

            // Calculate how much of the input is actually used
            const actualAmount0Used = BigInt(position.amount0.quotient.toString());
            const actualAmount1Used = BigInt(position.amount1.quotient.toString());
            const actualInputUsed = inputIsToken0 ? actualAmount0Used : actualAmount1Used;
            const inputUtilization = (actualInputUsed * 10000n) / inputAmount; // Basis points

            // Prioritize solutions that use more of the input (minimize leftover)
            const score = JSBI.multiply(liquidity, JSBI.BigInt(inputUtilization.toString()));

            if (JSBI.greaterThan(score, maxLiquidity)) {
                maxLiquidity = score;
                bestSwapAmount = mid;
                bestPosition = position;
                // Standard binary search: compare score to determine direction
                low = mid;
            } else {
                high = mid;
            }
        } catch (error) {
            console.error(`Binary search iteration ${i} failed:`, error);
            // On error, try searching in lower range
            high = mid;
        }
    }

    if (!bestPosition) {
        throw new Error('Failed to find optimal swap amount');
    }

    return { optimalSwapAmount: bestSwapAmount, resultingPosition: bestPosition };
}

export default async function handler(
    req: CalculateZapAmountsRequest,
    res: NextApiResponse<CalculateZapAmountsResponse | { error: string }>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            token0Symbol,
            token1Symbol,
            inputAmount,
            inputTokenSymbol,
            userTickLower,
            userTickUpper,
            chainId,
            slippageTolerance = 50,
        } = req.body;

        // Validate required fields
        if (!token0Symbol || !token1Symbol || !inputAmount || !inputTokenSymbol || !chainId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get token configurations
        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);
        const inputTokenConfig = getToken(inputTokenSymbol);

        if (!token0Config || !token1Config || !inputTokenConfig) {
            return res.status(400).json({ error: 'Invalid token symbols' });
        }

        // Get pool configuration
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);
        if (!poolConfig) {
            return res.status(400).json({ error: 'Pool not found for token pair' });
        }

        // Determine the other token
        const otherTokenSymbol = inputTokenSymbol === token0Symbol ? token1Symbol : token0Symbol;
        const otherTokenConfig = getToken(otherTokenSymbol);

        if (!otherTokenConfig) {
            return res.status(400).json({ error: 'Invalid other token' });
        }

        // Create SDK token instances
        const sdkInputToken = new Token(
            Number(chainId),
            getAddress(inputTokenConfig.address),
            inputTokenConfig.decimals,
            inputTokenConfig.symbol,
            inputTokenConfig.name
        );

        const sdkOtherToken = new Token(
            Number(chainId),
            getAddress(otherTokenConfig.address),
            otherTokenConfig.decimals,
            otherTokenConfig.symbol,
            otherTokenConfig.name
        );

        const sdkToken0 = new Token(
            Number(chainId),
            getAddress(token0Config.address),
            token0Config.decimals,
            token0Config.symbol,
            token0Config.name
        );

        const sdkToken1 = new Token(
            Number(chainId),
            getAddress(token1Config.address),
            token1Config.decimals,
            token1Config.symbol,
            token1Config.name
        );

        // Parse input amount
        const parsedInputAmount = parseUnits(inputAmount, inputTokenConfig.decimals);

        // Get pool state from StateView contract
        // Create pool ID from pool key
        const poolId = poolConfig.subgraphId as `0x${string}`;

        // Get slot0 (price and tick)
        const slot0Result = await publicClient.readContract({
            address: STATE_VIEW_ADDRESS,
            abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI),
            functionName: 'getSlot0',
            args: [poolId]
        }) as readonly [bigint, number, number, number];

        // Get liquidity
        const poolLiquidity = await publicClient.readContract({
            address: STATE_VIEW_ADDRESS,
            abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI),
            functionName: 'getLiquidity',
            args: [poolId]
        }) as bigint;

        const sqrtPriceX96 = slot0Result[0];
        const currentTick = Number(slot0Result[1]);

        // Create V4 pool
        const v4Pool = new V4Pool(
            sdkToken0,
            sdkToken1,
            poolConfig.fee,
            poolConfig.tickSpacing,
            getAddress(poolConfig.hooks),
            JSBI.BigInt(sqrtPriceX96.toString()),
            JSBI.BigInt(poolLiquidity.toString()),
            currentTick,
            []
        );

        // Ensure ticks are valid
        const tickLower = nearestUsableTick(userTickLower, poolConfig.tickSpacing);
        const tickUpper = nearestUsableTick(userTickUpper, poolConfig.tickSpacing);

        // Calculate optimal swap amount
        const { optimalSwapAmount, resultingPosition } = await calculateOptimalSwapAmount(
            sdkInputToken,
            sdkOtherToken,
            parsedInputAmount,
            tickLower,
            tickUpper,
            poolConfig,
            v4Pool
        );

        // Get swap quote for the optimal amount (if > 0)
        let minSwapOutput = 0n;
        if (optimalSwapAmount > 0n) {
            const swapQuote = await getSwapQuote(sdkInputToken, sdkOtherToken, optimalSwapAmount, poolConfig);
            minSwapOutput = (swapQuote.amountOut * BigInt(10000 - slippageTolerance)) / BigInt(10000);
        }

        // Calculate final amounts - these should add up to the full input value
        const remainingInput = parsedInputAmount - optimalSwapAmount;
        const swappedOutput = optimalSwapAmount > 0n
            ? (await getSwapQuote(sdkInputToken, sdkOtherToken, optimalSwapAmount, poolConfig)).amountOut
            : 0n;

        const inputIsToken0 = inputTokenSymbol === token0Symbol;

        // Return the ACTUAL amounts the position will use (from SDK calculation)
        // This accounts for the exact ratio needed at current price
        const finalToken0Amount = BigInt(resultingPosition.amount0.quotient.toString());
        const finalToken1Amount = BigInt(resultingPosition.amount1.quotient.toString());

        // Calculate leftover amounts (dust that won't be used)
        const providedToken0 = inputIsToken0 ? remainingInput : swappedOutput;
        const providedToken1 = inputIsToken0 ? swappedOutput : remainingInput;
        const leftoverToken0 = providedToken0 > finalToken0Amount ? providedToken0 - finalToken0Amount : 0n;
        const leftoverToken1 = providedToken1 > finalToken1Amount ? providedToken1 - finalToken1Amount : 0n;

        // Calculate price impact (simplified)
        const priceImpact = optimalSwapAmount > 0n
            ? ((optimalSwapAmount * 100n) / parsedInputAmount).toString()
            : "0";

        return res.status(200).json({
            optimalSwapAmount: formatUnits(optimalSwapAmount, inputTokenConfig.decimals),
            minSwapOutput: formatUnits(minSwapOutput, otherTokenConfig.decimals),
            expectedToken0Amount: formatUnits(finalToken0Amount, token0Config.decimals),
            expectedToken1Amount: formatUnits(finalToken1Amount, token1Config.decimals),
            expectedLiquidity: resultingPosition.liquidity.toString(),
            swapDirection: {
                from: inputTokenSymbol,
                to: otherTokenSymbol
            },
            priceImpact: priceImpact,
            leftoverToken0: formatUnits(leftoverToken0, token0Config.decimals),
            leftoverToken1: formatUnits(leftoverToken1, token1Config.decimals),
        });

    } catch (error: any) {
        console.error('[calculate-zap-amounts] Error:', error);
        return res.status(500).json({
            error: error.message || 'Failed to calculate zap amounts'
        });
    }
}
