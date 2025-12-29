import { Token, Percent, Ether, CurrencyAmount, TradeType, Fraction } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager, Route as V4Route, Trade as V4Trade, V4PositionPlanner, V4Planner, Actions, PoolKey } from "@uniswap/v4-sdk";
import type { MintOptions } from "@uniswap/v4-sdk";
import { RoutePlanner, CommandType } from '@uniswap/universal-router-sdk';
import { BigNumber } from 'ethers';
import { nearestUsableTick, TickMath, SqrtPriceMath, tickToPrice } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getQuoterAddress, getPoolByTokens, getUniversalRouterAddress, createPoolKeyFromConfig, getNetworkModeFromRequest } from "../../../lib/pools-config";
import { validateChainId, checkTxRateLimit } from "../../../lib/tx-validation";

import { createNetworkClient } from "../../../lib/viemClient";
import {
    isAddress,
    getAddress,
    parseAbi,
    maxUint256,
    parseUnits,
    formatUnits,
    type Hex
} from "viem";

import {
    PERMIT_EXPIRATION_DURATION_SECONDS,
    PERMIT_SIG_DEADLINE_DURATION_SECONDS,
    V4_QUOTER_ABI_STRINGS,
    EMPTY_BYTES,
    TX_DEADLINE_SECONDS,
    UniversalRouterAbi,
    PERMIT2_ADDRESS,
    Permit2Abi_allowance,
} from "../../../lib/swap-constants";

// Note: POSITION_MANAGER_ADDRESS, STATE_VIEW_ADDRESS, QUOTER_ADDRESS are now fetched dynamically per-request
// using getPositionManagerAddress(networkMode), getStateViewAddress(networkMode), getQuoterAddress(networkMode)
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

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

interface PrepareZapMintTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        inputAmount: string;
        inputTokenSymbol: TokenSymbol;
        userTickLower: number;
        userTickUpper: number;
        chainId: number;
        slippageTolerance?: number; // in basis points (50 = 0.5%), max 500 (5%)
        deadlineSeconds?: number; // Transaction deadline in seconds (default: TX_DEADLINE_SECONDS)
        approvalMode?: 'exact' | 'infinite';

        // Permit2 signature (if provided)
        permitSignature?: string;
        permitNonce?: number;
        permitExpiration?: number;
        permitSigDeadline?: string;
        permitAmount?: string;
    };
}

interface ZapQuoteResponse {
    swapAmount: string;
    expectedToken0Amount: string;
    expectedToken1Amount: string;
    expectedLiquidity: string;
    priceImpact: string;
    minimumReceived: {
        token0: string;
        token1: string;
    };
}

interface Permit2NeededResponse {
    needsApproval: true;
    approvalType: 'PERMIT2_SIGNATURE';
    permitData: {
        token: string;
        amount: string;
        nonce: number;
        expiration: number;
        sigDeadline: string;
        spender: string;
    };
    zapQuote: ZapQuoteResponse; // Include zapQuote so price impact warning can be shown even when approvals are needed
}

interface TransactionPreparedResponse {
    needsApproval: false;
    swapTransaction: {
        to: string;
        commands: string;
        inputs: string[];
        deadline: string;
        value: string;
    };
    mintTransaction: {
        to: string;
        data: string;
        value: string;
    };
    deadline: string;
    zapQuote: ZapQuoteResponse;
    details: {
        token0: { address: string; symbol: TokenSymbol; amount: string; };
        token1: { address: string; symbol: TokenSymbol; amount: string; };
        liquidity: string;
        finalTickLower: number;
        finalTickUpper: number;
        swapAmount: string;
        inputToken: TokenSymbol;
        remainingInputAmount: string;
    };
}

type PrepareZapMintTxResponse = TransactionPreparedResponse | Permit2NeededResponse | { message: string; error?: any };

// Helper function to normalize amount strings (handles scientific notation)
const normalizeAmountString = (raw: string): string => {
    let s = (raw ?? '').toString().trim().replace(/,/g, '.');
    if (!/e|E/.test(s)) return s;

    const match = s.match(/^([+-]?)(\d*\.?\d+)[eE]([+-]?\d+)$/);
    if (!match) return s;

    const sign = match[1] || '';
    const num = match[2];
    const exp = parseInt(match[3], 10);
    const parts = num.split('.');
    const intPart = parts[0] || '0';
    const fracPart = parts[1] || '';
    const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
    let pointIndex = intPart.length;
    let newPoint = pointIndex + exp;

    if (exp >= 0) {
        if (newPoint >= digits.length) {
            const zeros = '0'.repeat(newPoint - digits.length);
            return sign + digits + zeros;
        } else {
            return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
        }
    } else {
        if (newPoint <= 0) {
            const zeros = '0'.repeat(-newPoint);
            return sign + '0.' + zeros + digits;
        } else {
            return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
        }
    }
};

// Helper to get swap quote from V4 Quoter
async function getSwapQuote(
    fromToken: Token,
    toToken: Token,
    amountIn: bigint,
    poolConfig: any,
    publicClient: ReturnType<typeof createNetworkClient>,
    quoterAddress: `0x${string}`
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
            address: quoterAddress,
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
    v4Pool: V4Pool,
    publicClient: ReturnType<typeof createNetworkClient>,
    quoterAddress: `0x${string}`
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
            const swapQuote = await getSwapQuote(inputToken, otherToken, inputAmount, poolConfig, publicClient, quoterAddress);

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
                ? await getSwapQuote(inputToken, otherToken, clampedSwap, poolConfig, publicClient, quoterAddress)
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
                    
                    // CRITICAL: Check if simulated pool state would be out of range
                    // If so, the position will only use one token, causing large leftovers
                    const simulatedIsOutOfRange = nextTick < tickLower || nextTick > tickUpper;
                    if (simulatedIsOutOfRange) {
                        // Pool price moved outside range after swap - this will cause large leftover
                        // Return null to reject this swap amount (or handle specially)
                        // The optimizer will find a better solution or the position will be out-of-range
                        if (precise) {
                            console.warn(`[Optimizer] Simulated swap would move pool out of range: tick ${nextTick} not in [${tickLower}, ${tickUpper}]`);
                        }
                        // Continue with simulation but this will result in high leftover
                    }
                    
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
                    console.error('Pool simulation fallback (prepare zap):', simulationError);
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
            
            // Additional validation: Check if position is actually out of range
            const finalTick = poolForPosition.tickCurrent;
            const finalIsOutOfRange = finalTick < tickLower || finalTick > tickUpper;
            if (finalIsOutOfRange && precise) {
                console.warn(`[Optimizer] Position would be out of range: tick ${finalTick} not in [${tickLower}, ${tickUpper}]. This will cause large leftover.`);
            }

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
                        const conversionQuote = await getSwapQuote(otherToken, inputToken, leftoverOther, poolConfig, publicClient, quoterAddress);
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
                try {
                    const inputAmountCurrency = CurrencyAmount.fromRawAmount(
                        inputToken,
                        JSBI.BigInt(clampedSwap.toString())
                    );
                    const outputAmountCurrency = CurrencyAmount.fromRawAmount(
                        otherToken,
                        JSBI.BigInt(swapQuote.amountOut.toString())
                    );

                    const midPrice = tickToPrice(inputToken, otherToken, v4Pool.tickCurrent);
                    const expectedOutputCurrency = midPrice.quote(inputAmountCurrency);

                    const expectedRaw = expectedOutputCurrency.quotient;
                    const actualRaw = outputAmountCurrency.quotient;

                    if (!JSBI.equal(expectedRaw, JSBI.BigInt(0))) {
                        const differenceRaw = JSBI.greaterThan(expectedRaw, actualRaw)
                            ? JSBI.subtract(expectedRaw, actualRaw)
                            : JSBI.subtract(actualRaw, expectedRaw);

                        const priceImpactFraction = new Fraction(differenceRaw, expectedRaw);
                        const impactBpsFraction = priceImpactFraction.multiply(new Fraction(JSBI.BigInt(10_000), JSBI.BigInt(1)));
                        priceImpactBps = BigInt(impactBpsFraction.quotient.toString());
                    }
                } catch (priceImpactError) {
                    console.error("Failed to compute price impact precisely:", priceImpactError);
                    priceImpactBps = 0n;
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
    req: PrepareZapMintTxRequest,
    res: NextApiResponse<PrepareZapMintTxResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    // Rate limiting
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    const rateCheck = checkTxRateLimit(clientIp);
    if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
        return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }

    // Get network mode from cookies and create network-specific resources
    const networkMode = getNetworkModeFromRequest(req.headers.cookie);
    const publicClient = createNetworkClient(networkMode);
    const POSITION_MANAGER_ADDRESS = getPositionManagerAddress(networkMode);
    const STATE_VIEW_ADDRESS = getStateViewAddress(networkMode);
    const QUOTER_ADDRESS = getQuoterAddress(networkMode);

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    try {
        const {
            userAddress,
            token0Symbol,
            token1Symbol,
            inputAmount,
            inputTokenSymbol,
            userTickLower,
            userTickUpper,
            chainId,
            slippageTolerance = 50, // 0.5% default (50 basis points)
            deadlineSeconds = TX_DEADLINE_SECONDS, // Default to constant if not provided
            approvalMode = 'infinite',
        } = req.body;

        // ChainId validation - CRITICAL security check
        const chainIdError = validateChainId(chainId, networkMode);
        if (chainIdError) {
            return res.status(400).json({ message: chainIdError });
        }

        // Validate inputs
        if (!isAddress(userAddress)) {
            return res.status(400).json({ message: "Invalid userAddress." });
        }

        const token0Config = getToken(token0Symbol, networkMode);
        const token1Config = getToken(token1Symbol, networkMode);
        const inputTokenConfig = getToken(inputTokenSymbol, networkMode);

        if (!token0Config || !token1Config || !inputTokenConfig) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }

        if (isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
            return res.status(400).json({ message: "Invalid inputAmount." });
        }

        if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
            return res.status(400).json({ message: "userTickLower and userTickUpper must be numbers." });
        }

        // Determine which token is the input and which is the other
        const isInputToken0 = inputTokenSymbol === token0Symbol;
        const otherTokenSymbol = isInputToken0 ? token1Symbol : token0Symbol;
        const otherTokenConfig = getToken(otherTokenSymbol, networkMode);

        if (!otherTokenConfig) {
            return res.status(400).json({ message: "Invalid other token configuration." });
        }

        // Create SDK tokens
        const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);
        const sdkInputToken = isInputToken0 ? sdkToken0 : sdkToken1;
        const sdkOtherToken = isInputToken0 ? sdkToken1 : sdkToken0;

        // Parse input amount
        const normalizedInput = normalizeAmountString(inputAmount);
        const parsedInputAmount = parseUnits(normalizedInput, inputTokenConfig.decimals);

        // Extract Permit2 params from request body
        const { permitSignature, permitNonce, permitExpiration, permitSigDeadline, permitAmount } = req.body;

        // Check if input token is native ETH (no Permit2 needed)
        const isNativeInput = inputTokenConfig.address === ETHERS_ADDRESS_ZERO;

        // IMPORTANT: Calculate zap quote FIRST so price impact warning can be shown even when approvals are needed
        // Get pool configuration
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol, networkMode);
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${token0Symbol}/${token1Symbol}` });
        }

        // Clamp and align ticks
        const clampedUserTickLower = Math.max(userTickLower, TickMath.MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, TickMath.MAX_TICK);
        let tickLower = nearestUsableTick(clampedUserTickLower, poolConfig.tickSpacing);
        let tickUpper = nearestUsableTick(clampedUserTickUpper, poolConfig.tickSpacing);

        if (tickLower >= tickUpper) {
            tickLower = tickUpper - poolConfig.tickSpacing;
        }

        // Get sorted tokens for pool
        const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1)
            ? [sdkToken0, sdkToken1]
            : [sdkToken1, sdkToken0];

        // Get pool ID
        const poolId = V4Pool.getPoolId(
            sortedToken0,
            sortedToken1,
            poolConfig.fee,
            poolConfig.tickSpacing,
            getAddress(poolConfig.hooks) as `0x${string}`
        );

        // Query current pool state
        let currentSqrtPriceX96_JSBI: JSBI;
        let currentTick: number;
        let currentLiquidity: bigint;

        try {
            // Promise.allSettled pattern (identical to Uniswap getPool.ts)
            const [slot0Result, liquidityResult] = await Promise.allSettled([
                publicClient.readContract({
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbiViem,
                    functionName: 'getSlot0',
                    args: [poolId as Hex]
                }) as Promise<readonly [bigint, number, number, number]>,
                publicClient.readContract({
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbiViem,
                    functionName: 'getLiquidity',
                    args: [poolId as Hex]
                }) as Promise<bigint>
            ]);

            // Extract results - both required for pool state
            if (slot0Result.status !== 'fulfilled' || liquidityResult.status !== 'fulfilled') {
                const error = slot0Result.status === 'rejected' ? slot0Result.reason : liquidityResult.status === 'rejected' ? liquidityResult.reason : 'Unknown error';
                console.error("Error fetching pool state:", error);
                return res.status(500).json({ message: "Failed to fetch current pool data.", error: String(error?.message || error) });
            }

            const slot0 = slot0Result.value;
            const liquidity = liquidityResult.value;
            const sqrtPriceX96Current = slot0[0] as bigint;
            currentTick = slot0[1] as number;
            currentLiquidity = liquidity as bigint;
            currentSqrtPriceX96_JSBI = JSBI.BigInt(sqrtPriceX96Current.toString());

            if (sqrtPriceX96Current === 0n) {
                return res.status(400).json({
                    message: `Pool ${token0Symbol}/${token1Symbol} is not initialized.`
                });
            }
        } catch (error) {
            console.error("Error fetching pool state:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data.", error });
        }

        // Create V4 pool instance
        const poolCurrency0 = sortedToken0.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken0;
        const poolCurrency1 = sortedToken1.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken1;

        const v4Pool = new V4Pool(
            poolCurrency0 as any,
            poolCurrency1 as any,
            poolConfig.fee,
            poolConfig.tickSpacing,
            poolConfig.hooks as `0x${string}`,
            currentSqrtPriceX96_JSBI,
            JSBI.BigInt(currentLiquidity.toString()),
            currentTick
        );

        // Calculate optimal swap amount
        const { optimalSwapAmount, resultingPosition, priceImpact, error } = await calculateOptimalSwapAmount(
            sdkInputToken,
            sdkOtherToken,
            parsedInputAmount,
            tickLower,
            tickUpper,
            poolConfig,
            v4Pool,
            publicClient,
            QUOTER_ADDRESS
        );

        // Check if there was an error (e.g., price impact too high)
        if (error) {
            return res.status(400).json({
                message: error,
                error: `Price impact too high: ${priceImpact ? priceImpact.toFixed(3) : 'N/A'}%`
            });
        }
        
        // CRITICAL: Check if current pool state is out of range
        // If so, warn that large leftovers are likely due to price movement
        const isCurrentlyOutOfRange = currentTick < tickLower || currentTick > tickUpper;
        if (isCurrentlyOutOfRange) {
            console.warn(`[prepare-zap-mint-tx] WARNING: Pool price (tick ${currentTick}) is OUT OF RANGE [${tickLower}, ${tickUpper}]. Position will only use one token, causing large leftover.`);
        }

        // Extract amounts from the resulting position
        const amount0 = BigInt(resultingPosition.mintAmounts.amount0.toString());
        const amount1 = BigInt(resultingPosition.mintAmounts.amount1.toString());
        const liquidity = resultingPosition.liquidity;

        // Handle max uint values (SDK returns these for amounts not needed)
        const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const finalAmount0 = amount0 >= MAX_UINT256 / 2n ? 0n : amount0;
        const finalAmount1 = amount1 >= MAX_UINT256 / 2n ? 0n : amount1;

        // Validate liquidity
        const MAX_UINT_128 = (1n << 128n) - 1n;
        if (JSBI.GT(liquidity, JSBI.BigInt(MAX_UINT_128.toString()))) {
            return res.status(400).json({
                message: "The selected price range is too narrow for the provided input amount."
            });
        }

        // Use the calculated price impact from the optimization function (informational only)
        // Note: Price impact and slippage tolerance are different concepts:
        // - Price impact: how much quoted price deviates from mid price (market impact)
        // - Slippage tolerance: protection against execution price deviating from quoted price
        // We don't validate price impact against slippage tolerance - slippage is applied to the quote to get minimum amounts
        const priceImpactStr = priceImpact ? priceImpact.toFixed(3) : "0";

        // Enforce maximum slippage tolerance (500 basis points = 5%)
        const MAX_SLIPPAGE_TOLERANCE_BPS = 500;
        if (slippageTolerance > MAX_SLIPPAGE_TOLERANCE_BPS) {
            return res.status(400).json({
                message: `Slippage tolerance (${slippageTolerance / 100}%) exceeds maximum allowed (${MAX_SLIPPAGE_TOLERANCE_BPS / 100}%).`,
                error: `Slippage tolerance too high: ${slippageTolerance} bps`
            });
        }

        // Calculate minimum amounts with slippage
        const slippageMultiplier = BigInt(10000 - slippageTolerance);
        const minAmount0 = (finalAmount0 * slippageMultiplier) / 10000n;
        const minAmount1 = (finalAmount1 * slippageMultiplier) / 10000n;

        // Prepare zap quote response
        const zapQuote: ZapQuoteResponse = {
            swapAmount: optimalSwapAmount.toString(),
            expectedToken0Amount: finalAmount0.toString(),
            expectedToken1Amount: finalAmount1.toString(),
            expectedLiquidity: liquidity.toString(),
            priceImpact: priceImpactStr,
            minimumReceived: {
                token0: minAmount0.toString(),
                token1: minAmount1.toString()
            }
        };

        // NOW check Permit2 allowance AFTER calculating zap quote (so price impact can be shown even when approvals are needed)
        if (!isNativeInput && !permitSignature) {
            // Check current Permit2 allowance
            const [amount, expiration, nonce] = await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: Permit2Abi_allowance,
                functionName: 'allowance',
                args: [
                    getAddress(userAddress),
                    getAddress(inputTokenConfig.address),
                    getUniversalRouterAddress(networkMode)
                ]
            }) as readonly [bigint, number, number];

            const now = Math.floor(Date.now() / 1000);
            const needsPermit = amount < parsedInputAmount || expiration <= now;

            if (needsPermit) {
                // Return permit data for frontend to request signature
                // Include zapQuote so price impact warning can be shown
                const permitExpiration = now + PERMIT_EXPIRATION_DURATION_SECONDS;
                const permitSigDeadline = now + PERMIT_SIG_DEADLINE_DURATION_SECONDS;
                const MaxAllowanceTransferAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffff');
                const permitAmount = approvalMode === 'exact'
                    ? parsedInputAmount + 1n
                    : MaxAllowanceTransferAmount;

                return res.status(200).json({
                    needsApproval: true,
                    approvalType: 'PERMIT2_SIGNATURE',
                    permitData: {
                        token: getAddress(inputTokenConfig.address),
                        amount: permitAmount.toString(),
                        nonce: Number(nonce),
                        expiration: permitExpiration,
                        sigDeadline: permitSigDeadline.toString(),
                        spender: getUniversalRouterAddress(networkMode),
                    },
                    zapQuote: zapQuote // Include zapQuote so price impact warning can be shown
                });
            }
        }

        // Get deadline for transaction
        const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlock) throw new Error("Failed to get latest block.");
        const deadlineBigInt = latestBlock.timestamp + 1200n; // 20 minutes

        // Check if position involves native ETH
        const hasNativeETH = sortedToken0.address === ETHERS_ADDRESS_ZERO || sortedToken1.address === ETHERS_ADDRESS_ZERO;

        // ========== TRANSACTION 1: SWAP via Universal Router ==========
        const swapRoutePlanner = new RoutePlanner();

        // Add PERMIT2_PERMIT command for swap if we have a signature (and not native ETH)
        if (!isNativeInput && permitSignature && permitNonce !== undefined && permitExpiration && permitSigDeadline) {
            const MaxAllowanceTransferAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffff');
            const signedPermitAmount = permitAmount ? BigInt(permitAmount) : MaxAllowanceTransferAmount;
            swapRoutePlanner.addCommand(CommandType.PERMIT2_PERMIT, [
                [
                    [
                        getAddress(inputTokenConfig.address),
                        signedPermitAmount,
                        permitExpiration,                      // expiration (number)
                        permitNonce                            // nonce (number)
                    ],
                    getUniversalRouterAddress(networkMode),               // spender
                    BigInt(permitSigDeadline)                  // sigDeadline (bigint)
                ],
                permitSignature as Hex // The actual signature
            ]);
        }

        // Get PoolKey for the swap (reuse poolConfig from earlier)
        const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig);

        // Build V4 swap actions
        const swapPlanner = new V4Planner();

        // Determine swap direction
        const zeroForOne = getAddress(sdkInputToken.address!) === v4PoolKey.currency0;

        // Get actual swap quote output from V4Quoter (this is what we need to protect with slippage)
        let swapQuoteOutput: bigint = 0n;
        if (optimalSwapAmount > 0n) {
            const swapQuote = await getSwapQuote(sdkInputToken, sdkOtherToken, optimalSwapAmount, poolConfig, publicClient, QUOTER_ADDRESS);
            swapQuoteOutput = swapQuote.amountOut;
        }

        // Apply slippage tolerance to the actual swap quote output
        const minSwapOutputWithSlippage = swapQuoteOutput > 0n
            ? (swapQuoteOutput * BigInt(10000 - slippageTolerance)) / BigInt(10000)
            : 0n;

        // Verification: Calculate actual slippage applied and warn if suspicious
        const actualSlippageBps = swapQuoteOutput > 0n
            ? Number((swapQuoteOutput - minSwapOutputWithSlippage) * 10000n / swapQuoteOutput)
            : 0;
        const expectedSlippageBps = slippageTolerance;
        const slippageDiff = Math.abs(actualSlippageBps - expectedSlippageBps);

        // Skip swap if optimalSwapAmount is 0 (no swap needed)
        if (optimalSwapAmount > 0n) {
            // Add SWAP_EXACT_IN_SINGLE action
            swapPlanner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
                {
                    poolKey: v4PoolKey,
                    zeroForOne,
                    amountIn: BigNumber.from(optimalSwapAmount.toString()),
                    amountOutMinimum: BigNumber.from(minSwapOutputWithSlippage.toString()),
                    sqrtPriceLimitX96: BigNumber.from('0'), // No price limit
                    hookData: '0x'
                }
            ]);

            // Add SETTLE_ALL for input currency
            swapPlanner.addAction(Actions.SETTLE_ALL, [
                zeroForOne ? v4PoolKey.currency0 : v4PoolKey.currency1,
                BigNumber.from(optimalSwapAmount.toString()),
            ]);

            // Add TAKE_ALL for output currency
            const outputCurrency = zeroForOne ? v4PoolKey.currency1 : v4PoolKey.currency0;
            const isNativeOutput = outputCurrency === ETHERS_ADDRESS_ZERO;
            const takeAllMin = isNativeOutput ? BigInt(1) : minSwapOutputWithSlippage;

            swapPlanner.addAction(Actions.TAKE_ALL, [
                outputCurrency,
                BigNumber.from(takeAllMin.toString())
            ]);

            // Finalize swap planner and add to Universal Router
            const swapEncodedActions = swapPlanner.finalize() as Hex;
            swapRoutePlanner.addCommand(CommandType.V4_SWAP, [swapEncodedActions]);
        }

        // Finalize swap transaction
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const swapTxDeadline = currentTimestamp + BigInt(deadlineSeconds);
        const swapTxValue = isNativeInput ? optimalSwapAmount.toString() : '0';

        // ========== TRANSACTION 2: MINT POSITION via PositionManager ==========
        // Calculate remaining input amount after swap
        const remainingInputAmount = parsedInputAmount - optimalSwapAmount;

        // Use regular V4PositionManager.addCallParameters (same as non-zap liquidity)
        const mintOptions: MintOptions = {
            slippageTolerance: new Percent(slippageTolerance, 10_000),
            deadline: deadlineBigInt.toString(),
            recipient: getAddress(userAddress),
            hookData: '0x',
            useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
        };

        const mintMethodParameters = V4PositionManager.addCallParameters(resultingPosition, mintOptions);
        const mintTxValue = hasNativeETH ? remainingInputAmount.toString() : '0';

        return res.status(200).json({
            needsApproval: false,
            swapTransaction: {
                to: getUniversalRouterAddress(networkMode),
                commands: swapRoutePlanner.commands as Hex,
                inputs: swapRoutePlanner.inputs as Hex[],
                deadline: swapTxDeadline.toString(),
                value: swapTxValue
            },
            mintTransaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: mintMethodParameters.calldata,
                value: mintTxValue
            },
            deadline: deadlineBigInt.toString(),
            zapQuote,
            details: {
                token0: {
                    address: sortedToken0.address,
                    symbol: token0Symbol,
                    amount: finalAmount0.toString()
                },
                token1: {
                    address: sortedToken1.address,
                    symbol: token1Symbol,
                    amount: finalAmount1.toString()
                },
                liquidity: liquidity.toString(),
                finalTickLower: tickLower,
                finalTickUpper: tickUpper,
                swapAmount: optimalSwapAmount.toString(),
                inputToken: inputTokenSymbol,
                remainingInputAmount: remainingInputAmount.toString()
            }
        });

    } catch (error: any) {
        console.error("[API prepare-zap-mint-tx] Error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        return res.status(500).json({ message: errorMessage, error: error });
    }
}