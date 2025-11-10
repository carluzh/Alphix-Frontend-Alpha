/**
 * API endpoint for calculating optimal swap amounts for zapping
 * This performs the binary search to find the best swap amount
 * Returns the swap details that will be used for the actual transactions
 */

import { Token, Fraction } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import { nearestUsableTick, TickMath, SqrtPriceMath } from '@uniswap/v3-sdk';
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

const Q96n = 1n << 96n;
const Q192n = Q96n * Q96n;

const pow10 = (exp: number): bigint => {
    if (exp <= 0) return 1n;
    let result = 1n;
    for (let i = 0; i < exp; i++) {
        result *= 10n;
    }
    return result;
};

const absBigInt = (value: bigint): bigint => (value < 0n ? -value : value);

const mulDiv = (a: bigint, b: bigint, denominator: bigint): bigint => {
    if (denominator === 0n) return 0n;
    return (a * b) / denominator;
};

const mulDivSigned = (a: bigint, b: bigint, denominator: bigint): bigint => {
    if (denominator === 0n) return 0n;
    const negative = (a < 0n) !== (b < 0n);
    const denomNegative = denominator < 0n;
    const signNegative = negative !== denomNegative;
    const result = (absBigInt(a) * absBigInt(b)) / absBigInt(denominator);
    return signNegative ? -result : result;
};

const clampBigint = (value: bigint, min: bigint, max: bigint): bigint => {
    if (value < min) return min;
    if (value > max) return max;
    return value;
};

const bps = (value: bigint, base: bigint): bigint => {
    if (base === 0n) return 0n;
    return mulDiv(value, 10_000n, base);
};

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

// Calculate optimal swap amount using enhanced search with precise leftovers
async function calculateOptimalSwapAmount(
    inputToken: Token,
    otherToken: Token,
    inputAmount: bigint,
    tickLower: number,
    tickUpper: number,
    poolConfig: any,
    v4Pool: V4Pool
): Promise<{ optimalSwapAmount: bigint; resultingPosition: V4Position; priceImpact?: number; error?: string }> {

    if (inputAmount <= 0n) {
        const zeroPosition = V4Position.fromAmounts({
            pool: v4Pool,
            tickLower,
            tickUpper,
            amount0: JSBI.BigInt(0),
            amount1: JSBI.BigInt(0),
            useFullPrecision: true,
        });

        return { optimalSwapAmount: 0n, resultingPosition: zeroPosition, priceImpact: 0 };
    }

    const inputIsToken0 = inputToken.sortsBefore(otherToken);
    const currentTick = v4Pool.tickCurrent;
    const isOutOfRange = currentTick < tickLower || currentTick > tickUpper;

    if (isOutOfRange) {
        const needsToken0Only = currentTick >= tickUpper;
        const needsToken1Only = currentTick <= tickLower;

        if ((needsToken0Only && !inputIsToken0) || (needsToken1Only && inputIsToken0)) {
            const swapQuote = await getSwapQuote(inputToken, otherToken, inputAmount, poolConfig);

            const position = needsToken0Only
                ? V4Position.fromAmount0({
                    pool: v4Pool,
                    tickLower,
                    tickUpper,
                    amount0: JSBI.BigInt(swapQuote.amountOut.toString()),
                    useFullPrecision: true,
                })
                : V4Position.fromAmount1({
                    pool: v4Pool,
                    tickLower,
                    tickUpper,
                    amount1: JSBI.BigInt(swapQuote.amountOut.toString()),
                });

            return { optimalSwapAmount: inputAmount, resultingPosition: position, priceImpact: 0 };
        }

        const position = inputIsToken0
            ? V4Position.fromAmount0({
                pool: v4Pool,
                tickLower,
                tickUpper,
                amount0: JSBI.BigInt(inputAmount.toString()),
                useFullPrecision: true,
            })
            : V4Position.fromAmount1({
                pool: v4Pool,
                tickLower,
                tickUpper,
                amount1: JSBI.BigInt(inputAmount.toString()),
            });

        return { optimalSwapAmount: 0n, resultingPosition: position, priceImpact: 0 };
    }

    type SwapEvaluation = {
        swapAmount: bigint;
        position: V4Position;
        leftover0: bigint;
        leftover1: bigint;
        leftoverInputBase: bigint;
        leftoverOther: bigint;
        convertedOther: bigint;
        leftoverInputTotal: bigint;
        leftoverBps: bigint;
        imbalance: bigint;
        priceImpactBps: bigint;
        isPrecise: boolean;
    };

    const sqrtCurrentJsbi = v4Pool.sqrtRatioX96;
    const sqrtLowerJsbi = TickMath.getSqrtRatioAtTick(tickLower);
    const sqrtUpperJsbi = TickMath.getSqrtRatioAtTick(tickUpper);
    const q96Jsbi = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));

    const oneFraction = new Fraction(JSBI.BigInt(1), JSBI.BigInt(1));
    const zeroFraction = new Fraction(JSBI.BigInt(0), JSBI.BigInt(1));

    const sqrtCurrentFraction = new Fraction(sqrtCurrentJsbi, q96Jsbi);
    const sqrtLowerFraction = new Fraction(sqrtLowerJsbi, q96Jsbi);
    const sqrtUpperFraction = new Fraction(sqrtUpperJsbi, q96Jsbi);

    const amount0ForL = oneFraction
        .multiply(sqrtUpperFraction.subtract(sqrtCurrentFraction))
        .divide(sqrtCurrentFraction.multiply(sqrtUpperFraction));
    const amount1ForL = oneFraction.multiply(sqrtCurrentFraction.subtract(sqrtLowerFraction));
    const priceFraction = sqrtCurrentFraction.multiply(sqrtCurrentFraction);

    const value0Needed = amount0ForL.multiply(priceFraction);
    const value1Needed = amount1ForL;
    const totalValue = value0Needed.add(value1Needed);

    let swapFraction = new Fraction(JSBI.BigInt(1), JSBI.BigInt(2));
    if (!JSBI.equal(totalValue.numerator, JSBI.BigInt(0))) {
        const keepFraction = inputIsToken0 ? value0Needed.divide(totalValue) : value1Needed.divide(totalValue);
        swapFraction = oneFraction.subtract(keepFraction);
    }

    if (swapFraction.lessThan(zeroFraction)) {
        swapFraction = zeroFraction;
    } else if (swapFraction.greaterThan(oneFraction)) {
        swapFraction = oneFraction;
    }

    const inputAmountFraction = new Fraction(JSBI.BigInt(inputAmount.toString()), JSBI.BigInt(1));
    let theoreticalSwapAmount = BigInt(swapFraction.multiply(inputAmountFraction).quotient.toString());

    const poolFeeRaw = Number(poolConfig?.fee ?? 0);
    const poolFeeBps = Number.isFinite(poolFeeRaw) && poolFeeRaw > 0 ? BigInt(Math.floor(poolFeeRaw)) : 0n;
    if (poolFeeBps > 0n && poolFeeBps < 10_000n) {
        theoreticalSwapAmount = mulDiv(theoreticalSwapAmount, 10_000n, 10_000n - poolFeeBps);
    }

    theoreticalSwapAmount = clampBigint(theoreticalSwapAmount, 0n, inputAmount);

    const thresholdBps = 10n;
    const tolerance = clampBigint(inputAmount / 1_000_000n, 1n, inputAmount);
    const maxIterations = 24;

    const approxCache = new Map<string, SwapEvaluation>();
    let bestResult: SwapEvaluation | null = null;

    const selectBetter = (current: SwapEvaluation | null, next: SwapEvaluation): SwapEvaluation => {
        if (!current) return next;
        if (next.leftoverInputTotal < current.leftoverInputTotal) return next;
        if (next.leftoverInputTotal > current.leftoverInputTotal) return current;
        if (next.isPrecise && !current.isPrecise) return next;
        if (!next.isPrecise && current.isPrecise) return current;
        if (next.leftoverBps < current.leftoverBps) return next;
        if (next.leftoverBps > current.leftoverBps) return current;
        return absBigInt(next.imbalance) <= absBigInt(current.imbalance) ? next : current;
    };

    const recordCandidate = (candidate: SwapEvaluation | null) => {
        if (!candidate) return;
        bestResult = selectBetter(bestResult, candidate);
    };

    const evaluateSwapAmountInternal = async (testSwapAmount: bigint, precise: boolean): Promise<SwapEvaluation | null> => {
        try {
            const clampedSwap = clampBigint(testSwapAmount, 0n, inputAmount);
            const swapQuote = clampedSwap > 0n
                ? await getSwapQuote(inputToken, otherToken, clampedSwap, poolConfig)
                : { amountOut: 0n, gasEstimate: 0n };

            const remainingInput = inputAmount - clampedSwap;
            const receivedOther = swapQuote.amountOut;

            const amount0 = inputIsToken0 ? remainingInput : receivedOther;
            const amount1 = inputIsToken0 ? receivedOther : remainingInput;

            let poolForPosition = v4Pool;
            try {
                if (clampedSwap > 0n && swapQuote.amountOut > 0n && JSBI.greaterThan(v4Pool.liquidity, JSBI.BigInt(0))) {
                    const amountOutJsbi = JSBI.BigInt(swapQuote.amountOut.toString());
                    const nextSqrt = SqrtPriceMath.getNextSqrtPriceFromOutput(
                        v4Pool.sqrtRatioX96,
                        v4Pool.liquidity,
                        amountOutJsbi,
                        inputIsToken0
                    );
                    const nextTick = TickMath.getTickAtSqrtRatio(nextSqrt);
                    poolForPosition = new V4Pool(
                        v4Pool.currency0,
                        v4Pool.currency1,
                        v4Pool.fee,
                        v4Pool.tickSpacing,
                        v4Pool.hooks,
                        nextSqrt,
                        v4Pool.liquidity,
                        nextTick
                    );
                }
            } catch (simulationError) {
                if (precise) {
                    console.error('Pool simulation fallback (calculate zap):', simulationError);
                }
                poolForPosition = v4Pool;
            }

            const position = V4Position.fromAmounts({
                pool: poolForPosition,
                tickLower,
                tickUpper,
                amount0: JSBI.BigInt(amount0.toString()),
                amount1: JSBI.BigInt(amount1.toString()),
                useFullPrecision: true,
            });

            const usedAmount0 = BigInt(position.amount0.quotient.toString());
            const usedAmount1 = BigInt(position.amount1.quotient.toString());

            const leftover0 = amount0 > usedAmount0 ? amount0 - usedAmount0 : 0n;
            const leftover1 = amount1 > usedAmount1 ? amount1 - usedAmount1 : 0n;

            const leftoverInputBase = inputIsToken0 ? leftover0 : leftover1;
            const leftoverOther = inputIsToken0 ? leftover1 : leftover0;

            let convertedOther = 0n;
            if (leftoverOther > 0n) {
                if (precise) {
                    try {
                        const conversionQuote = await getSwapQuote(otherToken, inputToken, leftoverOther, poolConfig);
                        convertedOther = conversionQuote.amountOut;
                    } catch {
                        if (clampedSwap > 0n && swapQuote.amountOut > 0n) {
                            convertedOther = mulDiv(leftoverOther, clampedSwap, swapQuote.amountOut);
                        }
                    }
                } else if (clampedSwap > 0n && swapQuote.amountOut > 0n) {
                    convertedOther = mulDiv(leftoverOther, clampedSwap, swapQuote.amountOut);
                }
            }

            const leftoverInputTotal = leftoverInputBase + convertedOther;
            const leftoverBpsValue = bps(leftoverInputTotal, inputAmount);
            const imbalance = leftoverInputBase - convertedOther;

            let priceImpactBps = 0n;
            if (clampedSwap > 0n && swapQuote.amountOut > 0n) {
                const sqrtPriceX96n = BigInt(v4Pool.sqrtRatioX96.toString());
                const sqrtPriceSquared = sqrtPriceX96n * sqrtPriceX96n;

                let expectedOutput = mulDiv(clampedSwap, sqrtPriceSquared, Q192n);
                const decimalsDiff = otherToken.decimals - inputToken.decimals;
                if (decimalsDiff !== 0) {
                    const adjustment = pow10(Math.abs(decimalsDiff));
                    if (decimalsDiff > 0) {
                        expectedOutput *= adjustment;
                    } else if (adjustment > 0n) {
                        expectedOutput /= adjustment;
                    }
                }

                if (expectedOutput > 0n) {
                    const difference = expectedOutput > swapQuote.amountOut
                        ? expectedOutput - swapQuote.amountOut
                        : swapQuote.amountOut - expectedOutput;
                    priceImpactBps = bps(difference, expectedOutput);
                }
            }

            return {
                swapAmount: clampedSwap,
                position,
                leftover0,
                leftover1,
                leftoverInputBase,
                leftoverOther,
                convertedOther,
                leftoverInputTotal,
                leftoverBps: leftoverBpsValue,
                imbalance,
                priceImpactBps,
                isPrecise: precise,
            };
        } catch (error) {
            console.error(`Error evaluating swap amount ${testSwapAmount.toString()}:`, error);
            return null;
        }
    };

    const evaluate = async (amount: bigint, precise = false): Promise<SwapEvaluation | null> => {
        const clamped = clampBigint(amount, 0n, inputAmount);
        const key = clamped.toString();

        const cached = approxCache.get(key);
        if (cached) {
            if (!precise || cached.isPrecise) {
                recordCandidate(cached);
                return cached;
            }
        }

        const evaluation = await evaluateSwapAmountInternal(clamped, precise);
        if (!evaluation) return null;

        if (!approxCache.has(key) || precise) {
            approxCache.set(key, evaluation);
        }

        recordCandidate(evaluation);
        return evaluation;
    };

    await evaluate(0n, true);
    if (inputAmount > 0n) {
        await evaluate(inputAmount, true);
    }

    let low = 0n;
    let high = inputAmount;
    let iterations = 0;
    let nextGuess: bigint | null = theoreticalSwapAmount;
    let prevResult: SwapEvaluation | null = null;

    while (iterations < maxIterations && low <= high) {
        iterations++;

        const guess = nextGuess !== null ? clampBigint(nextGuess, 0n, inputAmount) : clampBigint((low + high) / 2n, 0n, inputAmount);
        nextGuess = null;

        const result = await evaluate(guess, true);
        if (!result) {
            high = guess > 0n ? guess - 1n : 0n;
            if (high < 0n) high = 0n;
            if (high <= low || high - low <= tolerance) break;
            continue;
        }

        if (result.leftoverBps <= thresholdBps) {
            const preciseResult = await evaluate(result.swapAmount, true);
            if (preciseResult && preciseResult.leftoverBps <= thresholdBps) {
                bestResult = selectBetter(bestResult, preciseResult);
                break;
            }
        }

        const sign = result.imbalance === 0n ? 0 : (result.imbalance > 0n ? 1 : -1);
        let secantCandidate: bigint | null = null;

        if (prevResult && sign !== 0) {
            const prevSign = prevResult.imbalance === 0n ? 0 : (prevResult.imbalance > 0n ? 1 : -1);
            if (prevSign !== 0 && prevSign !== sign) {
                const swapDiff = result.swapAmount - prevResult.swapAmount;
                const imbalanceDiff = result.imbalance - prevResult.imbalance;
                if (imbalanceDiff !== 0n) {
                    secantCandidate = result.swapAmount - mulDivSigned(result.imbalance, swapDiff, imbalanceDiff);
                }
            }
        }

        if (sign > 0) {
            low = result.swapAmount >= inputAmount ? inputAmount : result.swapAmount + 1n;
        } else if (sign < 0) {
            high = result.swapAmount > 0n ? result.swapAmount - 1n : 0n;
        } else {
            low = result.swapAmount;
            high = result.swapAmount;
        }

        if (secantCandidate !== null) {
            const candidate = clampBigint(secantCandidate, 0n, inputAmount);
            if (candidate > low && candidate < high && !approxCache.has(candidate.toString())) {
                nextGuess = candidate;
            }
        }

        prevResult = result;

        if (high <= low || high - low <= tolerance) {
            break;
        }
    }

    if (bestResult) {
        const window = clampBigint(inputAmount / 2000n, 1n, inputAmount);
        const polishCandidates = [
            clampBigint(bestResult.swapAmount - window, 0n, inputAmount),
            clampBigint(bestResult.swapAmount + window, 0n, inputAmount),
        ];

        for (const candidate of polishCandidates) {
            const precise = await evaluate(candidate, true);
            if (precise) {
                bestResult = selectBetter(bestResult, precise);
            }
        }
    }

    if (bestResult && !bestResult.isPrecise) {
        const preciseBest = await evaluate(bestResult.swapAmount, true);
        if (preciseBest) {
            bestResult = selectBetter(bestResult, preciseBest);
        }
    }

    if (bestResult && bestResult.leftoverBps > thresholdBps) {
        const fineStep = clampBigint(inputAmount / 10_000n, 1n, inputAmount);
        const fineCandidates = [
            clampBigint(bestResult.swapAmount - fineStep, 0n, inputAmount),
            clampBigint(bestResult.swapAmount + fineStep, 0n, inputAmount),
        ];

        for (const candidate of fineCandidates) {
            const precise = await evaluate(candidate, true);
            if (precise) {
                bestResult = selectBetter(bestResult, precise);
            }
        }
    }

    if (!bestResult) {
        return {
            optimalSwapAmount: 0n,
            resultingPosition: V4Position.fromAmounts({
                pool: v4Pool,
                tickLower,
                tickUpper,
                amount0: JSBI.BigInt(0),
                amount1: JSBI.BigInt(0),
                useFullPrecision: true,
            }),
            priceImpact: 0,
            error: "Optimization failed",
        };
    }

    const finalPriceImpact = Number(bestResult.priceImpactBps) / 100;

    return {
        optimalSwapAmount: bestResult.swapAmount,
        resultingPosition: bestResult.position,
        priceImpact: Number.isFinite(finalPriceImpact) ? finalPriceImpact : 0,
    };
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
