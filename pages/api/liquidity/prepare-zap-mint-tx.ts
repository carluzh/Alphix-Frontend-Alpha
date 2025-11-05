import { Token, Percent, Ether, CurrencyAmount, TradeType } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager, Route as V4Route, Trade as V4Trade, V4PositionPlanner, V4Planner, Actions, PoolKey } from "@uniswap/v4-sdk";
import type { MintOptions } from "@uniswap/v4-sdk";
import { RoutePlanner, CommandType } from '@uniswap/universal-router-sdk';
import { BigNumber } from 'ethers';
import { nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getQuoterAddress, getPoolByTokens, getUniversalRouterAddress, createPoolKeyFromConfig } from "../../../lib/pools-config";

import { publicClient } from "../../../lib/viemClient";
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

const POSITION_MANAGER_ADDRESS = getPositionManagerAddress();
const STATE_VIEW_ADDRESS = getStateViewAddress();
const QUOTER_ADDRESS = getQuoterAddress();
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

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
        slippageTolerance?: number; // in basis points (50 = 0.5%)

        // Permit2 signature (if provided)
        permitSignature?: string;
        permitNonce?: number;
        permitExpiration?: number;
        permitSigDeadline?: string;
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
                    amount1: JSBI.BigInt(swapQuote.amountOut.toString()),
                    useFullPrecision: true
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
                    amount1: JSBI.BigInt(inputAmount.toString()),
                    useFullPrecision: true
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

    // Binary search with ~10 iterations for precision
    const iterations = 10;
    for (let i = 0; i < iterations; i++) {
        const mid = (low + high) / 2n;

        // Skip if mid is 0 on first iteration (we'll check 0 separately)
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
            const inputIsToken0 = inputToken.sortsBefore(otherToken);
            const amount0 = inputIsToken0 ? remainingInput : receivedOther;
            const amount1 = inputIsToken0 ? receivedOther : remainingInput;

            // Create position with these amounts
            const position = V4Position.fromAmounts({
                pool: v4Pool,
                tickLower,
                tickUpper,
                amount0: JSBI.BigInt(amount0.toString()),
                amount1: JSBI.BigInt(amount1.toString()),
                useFullPrecision: true
            });

            // Check if this gives us more liquidity
            if (JSBI.greaterThan(position.liquidity, maxLiquidity)) {
                maxLiquidity = position.liquidity;
                bestSwapAmount = mid;
                bestPosition = position;
            }

            // Adjust search range based on the ratio of amounts needed
            // This is a simplified heuristic - could be improved with more sophisticated math
            const mintAmount0 = BigInt(position.mintAmounts.amount0.toString());
            const mintAmount1 = BigInt(position.mintAmounts.amount1.toString());

            // Check if we need more of the other token (swap more) or less (swap less)
            if (mintAmount0 > 0n && mintAmount1 > 0n) {
                // Both amounts are being used, check the ratio
                // This is a rough heuristic and could be refined
                if (inputIsToken0 && mintAmount0 > mintAmount1 * 2n) {
                    // We have too much token0 left, swap more
                    low = mid + 1n;
                } else if (!inputIsToken0 && mintAmount1 > mintAmount0 * 2n) {
                    // We have too much token1 left, swap more
                    low = mid + 1n;
                } else {
                    // Ratio seems balanced, continue binary search normally
                    if (i < iterations / 2) {
                        high = mid - 1n;
                    } else {
                        low = mid + 1n;
                    }
                }
            } else {
                // One amount is zero, adjust accordingly
                if ((inputIsToken0 && mintAmount0 === 0n) || (!inputIsToken0 && mintAmount1 === 0n)) {
                    // We swapped too much, reduce swap amount
                    high = mid - 1n;
                } else {
                    // We need to swap more
                    low = mid + 1n;
                }
            }
        } catch (error) {
            console.error(`Error at swap amount ${mid.toString()}:`, error);
            // On error, try a different amount
            high = mid - 1n;
        }
    }

    if (!bestPosition) {
        throw new Error("Could not find optimal swap amount");
    }

    return { optimalSwapAmount: bestSwapAmount, resultingPosition: bestPosition };
}

export default async function handler(
    req: PrepareZapMintTxRequest,
    res: NextApiResponse<PrepareZapMintTxResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

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
            slippageTolerance = 50, // 0.5% default
        } = req.body;

        // Validate inputs
        if (!isAddress(userAddress)) {
            return res.status(400).json({ message: "Invalid userAddress." });
        }

        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);
        const inputTokenConfig = getToken(inputTokenSymbol);

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
        const otherTokenConfig = getToken(otherTokenSymbol);

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
        const { permitSignature, permitNonce, permitExpiration, permitSigDeadline } = req.body;

        // Check if input token is native ETH (no Permit2 needed)
        const isNativeInput = inputTokenConfig.address === ETHERS_ADDRESS_ZERO;

        // Check Permit2 allowance if not native ETH
        if (!isNativeInput && !permitSignature) {
            // Check current Permit2 allowance
            const [amount, expiration, nonce] = await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: Permit2Abi_allowance,
                functionName: 'allowance',
                args: [
                    getAddress(userAddress),
                    getAddress(inputTokenConfig.address),
                    getUniversalRouterAddress()
                ]
            }) as readonly [bigint, number, number];

            const now = Math.floor(Date.now() / 1000);
            const needsPermit = amount < parsedInputAmount || expiration <= now;

            if (needsPermit) {
                // Return permit data for frontend to request signature
                const permitExpiration = now + PERMIT_EXPIRATION_DURATION_SECONDS;
                const permitSigDeadline = now + PERMIT_SIG_DEADLINE_DURATION_SECONDS;

                return res.status(200).json({
                    needsApproval: true,
                    approvalType: 'PERMIT2_SIGNATURE',
                    permitData: {
                        token: getAddress(inputTokenConfig.address),
                        amount: parsedInputAmount.toString(),
                        nonce: Number(nonce),
                        expiration: permitExpiration,
                        sigDeadline: permitSigDeadline.toString(),
                        spender: getUniversalRouterAddress(),
                    }
                });
            }
        }

        // Get pool configuration
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${token0Symbol}/${token1Symbol}` });
        }

        // Clamp and align ticks
        const clampedUserTickLower = Math.max(userTickLower, SDK_MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, SDK_MAX_TICK);
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
            const [slot0, liquidity] = await Promise.all([
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
        console.log("Calculating optimal swap amount for zap...");
        const { optimalSwapAmount, resultingPosition } = await calculateOptimalSwapAmount(
            sdkInputToken,
            sdkOtherToken,
            parsedInputAmount,
            tickLower,
            tickUpper,
            poolConfig,
            v4Pool
        );

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

        // Calculate price impact (simplified - could be enhanced)
        let priceImpact = "0";
        if (optimalSwapAmount > 0n) {
            // Rough estimate: (swapAmount / poolLiquidity) * 100
            const swapImpact = (optimalSwapAmount * 10000n) / (currentLiquidity > 0n ? currentLiquidity : 1n);
            priceImpact = formatUnits(swapImpact, 2); // Convert to percentage
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
            priceImpact,
            minimumReceived: {
                token0: minAmount0.toString(),
                token1: minAmount1.toString()
            }
        };

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
            swapRoutePlanner.addCommand(CommandType.PERMIT2_PERMIT, [
                [
                    [
                        getAddress(inputTokenConfig.address), // token
                        BigInt(optimalSwapAmount.toString()), // only permit the amount we're swapping
                        permitExpiration,                      // expiration (number)
                        permitNonce                            // nonce (number)
                    ],
                    getUniversalRouterAddress(),               // spender
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

        // Calculate minimum output with slippage
        const minSwapOutput = isInputToken0 ? finalAmount1 : finalAmount0;
        const minSwapOutputWithSlippage = (BigInt(minSwapOutput.toString()) * BigInt(10000 - slippageTolerance)) / BigInt(10000);

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

        // Finalize swap transaction
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const swapTxDeadline = currentTimestamp + BigInt(TX_DEADLINE_SECONDS);
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
                to: getUniversalRouterAddress(),
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