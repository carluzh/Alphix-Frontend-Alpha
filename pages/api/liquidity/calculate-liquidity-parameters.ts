import { Token, Price, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk"; 
import { TickMath, nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { getToken, TokenSymbol, getStateViewAddress } from "@/lib/pools-config";
import { publicClient } from "@/lib/viemClient"; 
import { parseUnits, getAddress, parseAbi, type Hex } from "viem";

// No local amount parsing: request supplies a single formatted amount handled in prepare-mint

// Contract addresses from pools config
const STATE_VIEW_ADDRESS = getStateViewAddress(); 
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

interface CalculateLiquidityParamsRequest extends NextApiRequest {
    body: {
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        inputAmount: string;      
        inputTokenSymbol: TokenSymbol; 
        userTickLower?: number;
        userTickUpper?: number;
        fullRange?: boolean;
        tickRangeAmount?: number;
        chainId: number; 
        userAddress?: string; 
    };
}

interface CalculateLiquidityParamsResponse {
    liquidity: string;
    finalTickLower: number;
    finalTickUpper: number;
    amount0: string; // Amount for the token originally passed as token0Symbol
    amount1: string; // Amount for the token originally passed as token1Symbol
    currentPoolTick: number; // Added current pool tick from slot0
    currentPrice: string;      // Price of token1Symbol in terms of token0Symbol
    priceAtTickLower: string; // Price of token1Symbol in terms of token0Symbol at finalTickLower
    priceAtTickUpper: string; // Price of token1Symbol in terms of token0Symbol at finalTickUpper
}

type ApiResponse = CalculateLiquidityParamsResponse | { message: string; error?: any };

// Helper function to calculate price of tokenB in terms of tokenA from a sqrtPriceX96
// sqrtPriceX96 is for poolToken1/poolToken0 (where poolToken0 and poolToken1 are the sorted tokens in the pool)
function calculatePriceString(
    sqrtPriceX96_JSBI: JSBI,
    poolSortedToken0: Token, // Token that sorts first by address 
    poolSortedToken1: Token, // Token that sorts second by address 
    desiredPriceOfToken: Token, // The token WE WANT THE PRICE OF
    desiredPriceInToken: Token,  // The token WE WANT THE PRICE IN TERMS OF
    callContext: string // Added for logging context e.g., "currentPrice", "priceAtTickLower"
): string {
    console.log(`\\n[calculatePriceString CALLED - Context: ${callContext}]`);
    console.log(`  Input sqrtPriceX96: ${sqrtPriceX96_JSBI.toString()}`);
    console.log(`  poolSortedToken0: ${poolSortedToken0.symbol} (Decimals: ${poolSortedToken0.decimals}, Address: ${poolSortedToken0.address})`);
    console.log(`  poolSortedToken1: ${poolSortedToken1.symbol} (Decimals: ${poolSortedToken1.decimals}, Address: ${poolSortedToken1.address})`);
    console.log(`  desiredPriceOfToken: ${desiredPriceOfToken.symbol} (Decimals: ${desiredPriceOfToken.decimals}, Address: ${desiredPriceOfToken.address})`);
    console.log(`  desiredPriceInToken: ${desiredPriceInToken.symbol} (Decimals: ${desiredPriceInToken.decimals}, Address: ${desiredPriceInToken.address})`);

    // Generic calculation: sqrtPriceX96_JSBI corresponds to sqrt(token1_raw_units / token0_raw_units) * 2^96
    const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));

    // Calculate the price ratio: (token1_raw_units / token0_raw_units)
    const rawToken1UnitsNumerator = JSBI.multiply(sqrtPriceX96_JSBI, sqrtPriceX96_JSBI);
    const rawToken0UnitsDenominator = JSBI.multiply(Q96, Q96);

    // Price<poolSortedToken0, poolSortedToken1> means Price of poolSortedToken1 in terms of poolSortedToken0
    // Constructor: new Price(baseCurrency, quoteCurrency, denominator_raw_amount_of_base, numerator_raw_amount_of_quote)
    const priceToken1PerToken0 = new Price(
        poolSortedToken0, // Base currency (denominator)
        poolSortedToken1, // Quote currency (numerator)
        rawToken0UnitsDenominator, // Denominator: raw amount of token0 (base)
        rawToken1UnitsNumerator  // Numerator: raw amount of token1 (quote)
    );
    console.log(`  Intermediate calculated price ${poolSortedToken1.symbol} per ${poolSortedToken0.symbol}: ${priceToken1PerToken0.toSignificant(18)}`);

    let finalPriceObject: Price<Token, Token>;

    if (desiredPriceOfToken.equals(poolSortedToken1) && desiredPriceInToken.equals(poolSortedToken0)) {
        // We want Price of poolSortedToken1 in terms of poolSortedToken0
        console.log(`  Branch: Desired Price of ${poolSortedToken1.symbol} in terms of ${poolSortedToken0.symbol}. Using direct intermediate price.`);
        finalPriceObject = priceToken1PerToken0;
    } else if (desiredPriceOfToken.equals(poolSortedToken0) && desiredPriceInToken.equals(poolSortedToken1)) {
        // We want Price of poolSortedToken0 in terms of poolSortedToken1
        console.log(`  Branch: Desired Price of ${poolSortedToken0.symbol} in terms of ${poolSortedToken1.symbol}. Inverting intermediate price.`);
        finalPriceObject = priceToken1PerToken0.invert();
    } else {
        throw new Error(`[calculatePriceString:${callContext}] Desired pair ${desiredPriceOfToken.symbol}/${desiredPriceInToken.symbol} does not match sorted pool pair ${poolSortedToken0.symbol}/${poolSortedToken1.symbol}.`);
    }
    
    const highPrecisionPrice = finalPriceObject.toSignificant(18);
    console.log(`  Final Price object output (toSignificant(18)): ${highPrecisionPrice}`);
    
    const finalResult = finalPriceObject.toSignificant(8); 
    console.log(`  Final formatted price string (toSignificant(8)): ${finalResult}`);
    console.log(`[calculatePriceString END - Context: ${callContext}]\n`);
    return finalResult;
}

export default async function handler(
    req: CalculateLiquidityParamsRequest,
    res: NextApiResponse<ApiResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    try {
        const {
            token0Symbol,
            token1Symbol,
            inputAmount,
            inputTokenSymbol,
            userTickLower,
            userTickUpper,
            fullRange,
            tickRangeAmount,
            chainId,
        } = req.body;

        // --- Input Validation ---
        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);
        const inputTokenConfig = inputTokenSymbol ? getToken(inputTokenSymbol) : null;

        if (!token0Config || !token1Config) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }
        // This endpoint does not parse amounts; it's for tick math and quoting outputs only
        // TODO: Add more validation for chainId, perhaps ensure it matches a configured supported ID

        // --- Get Pool Configuration ---
        const { getPoolByTokens } = await import('@/lib/pools-config');
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);
        
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${token0Symbol}/${token1Symbol}` });
        }

        // --- SDK Token Objects ---
        // console.log("[API] Creating Token0 with", { symbol: token0Symbol, address: token0Config.address });
        const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
        // console.log("[API] Successfully created Token0.", sdkToken0Original);

        // console.log("[API] Creating Token1 with", { symbol: token1Symbol, address: token1Config.address });
        const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);
        // console.log("[API] Successfully created Token1.", sdkToken1Original);

        const sdkInputToken = inputTokenSymbol ? new Token(chainId, getAddress(inputTokenConfig!.address), inputTokenConfig!.decimals, inputTokenConfig!.symbol) : undefined;
        const normalizeAmountString = (raw: string): string => {
            let s = (raw ?? '').toString().trim().replace(/,/g, '.');
            if (!/e|E/.test(s)) return s;
            const m = s.match(/^([+-]?)\n?(\d*\.?\d+)[eE]([+-]?\d+)$/) || s.match(/^([+-]?)(\d*\.?\d+)[eE]([+-]?\d+)$/);
            if (!m) return s;
            const sign = m[1] || '';
            const num = m[2];
            const exp = parseInt(m[3], 10);
            const parts = num.split('.');
            const intPart = parts[0] || '0';
            const fracPart = parts[1] || '';
            const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
            const pointIndex = intPart.length;
            const newPoint = pointIndex + exp;
            if (exp >= 0) {
                if (newPoint >= digits.length) return sign + digits + '0'.repeat(newPoint - digits.length);
                return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
            } else {
                if (newPoint <= 0) return sign + '0.' + '0'.repeat(-newPoint) + digits;
                return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
            }
        };
        const parsedInputAmount = inputAmount && sdkInputToken ? parseUnits(normalizeAmountString(inputAmount), sdkInputToken.decimals) : 0n;

        // ticks to be computed once slot0 is known if tickRangeAmount/fullRange used
        let tickLower: number = 0;
        let tickUpper: number = 0;

        // --- Token Sorting (Crucial for V4 SDK) ---
        const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1) 
            ? [sdkToken0, sdkToken1] 
            : [sdkToken1, sdkToken0];

        // Derive poolId with SDK helper
        const poolId = V4Pool.getPoolId(
            sortedToken0,
            sortedToken1,
            poolConfig.fee,
            poolConfig.tickSpacing,
            getAddress(poolConfig.hooks) as `0x${string}`
        );

        // Fetch current pool state

        // --- Fetch Pool Slot0 and Liquidity (Promise.all per guide) ---
        let rawSqrtPriceX96String: string;
        let currentTickFromSlot0: number;
        // lpFeeFromSlot0 was previously read but unused; removed for clarity
        let currentSqrtPriceX96_JSBI: JSBI;
        let currentLiquidity: bigint;

        try {
            console.log("[API DEBUG] Calling getSlot0/getLiquidity with Pool ID:", poolId);
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

            rawSqrtPriceX96String = slot0[0].toString();
            currentTickFromSlot0 = Number(slot0[1]);
            currentLiquidity = liquidity as bigint;
            currentSqrtPriceX96_JSBI = JSBI.BigInt(rawSqrtPriceX96String);

        } catch (error) {
            console.error("API Error (calculate-liquidity-parameters) fetching pool state:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data for calculation.", error });
        }

        // State fetched

        // --- Compute ticks now (guide: nearestUsableTick) ---
        if (fullRange) {
            tickLower = nearestUsableTick(SDK_MIN_TICK, poolConfig.tickSpacing);
            tickUpper = nearestUsableTick(SDK_MAX_TICK, poolConfig.tickSpacing);
        } else if (typeof tickRangeAmount === 'number' && isFinite(tickRangeAmount)) {
            tickLower = nearestUsableTick(currentTickFromSlot0 - tickRangeAmount, poolConfig.tickSpacing);
            tickUpper = nearestUsableTick(currentTickFromSlot0 + tickRangeAmount, poolConfig.tickSpacing);
        } else {
            if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
                return res.status(400).json({ message: "userTickLower and userTickUpper must be numbers when not using fullRange/tickRangeAmount." });
            }
            const clampedLower = Math.max(userTickLower, SDK_MIN_TICK);
            const clampedUpper = Math.min(userTickUpper, SDK_MAX_TICK);
            tickLower = nearestUsableTick(clampedLower, poolConfig.tickSpacing);
            tickUpper = nearestUsableTick(clampedUpper, poolConfig.tickSpacing);
        }
        if (tickLower >= tickUpper) {
            tickLower = tickUpper - poolConfig.tickSpacing;
        }

        // --- Create V4Pool for Calculation ---
        const poolCurrency0 = sortedToken0.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken0;
        const poolCurrency1 = sortedToken1.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken1;

        const v4PoolForCalc = new V4Pool(
            poolCurrency0 as any,
            poolCurrency1 as any,
            poolConfig.fee, // Use fee from pool configuration 
            poolConfig.tickSpacing, // Use tick spacing from pool configuration
            poolConfig.hooks as `0x${string}`, // Use hook address from pool configuration
            currentSqrtPriceX96_JSBI, // Use JSBI instance
            JSBI.BigInt(currentLiquidity.toString()),
            currentTickFromSlot0 // Use numeric tick
        );


        // --- Position calc (single-input only) ---
        let positionForCalc: V4Position | undefined;
        let liquidity = "0";
        let amount0Sorted = "0";
        let amount1Sorted = "0";

        if (sdkInputToken) {
            if (sdkInputToken.address === sortedToken0.address) {
                positionForCalc = V4Position.fromAmount0({
                    pool: v4PoolForCalc,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0: JSBI.BigInt(parsedInputAmount.toString()),
                    useFullPrecision: true
                });
            } else {
                positionForCalc = V4Position.fromAmount1({
                    pool: v4PoolForCalc,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount1: JSBI.BigInt(parsedInputAmount.toString())
                });
            }
        }

        if (positionForCalc) {
            liquidity = positionForCalc.liquidity.toString();
            amount0Sorted = positionForCalc.mintAmounts.amount0.toString();
            amount1Sorted = positionForCalc.mintAmounts.amount1.toString();
        }

        // Removed BigInt overflow/sanity checks to keep endpoint minimal; SDK outputs are trusted here

        // --- Map calculated amounts back to original token0Symbol and token1Symbol ---
        let finalAmount0: string;
        let finalAmount1: string;

        if (sdkToken0.address === sortedToken0.address) {
            // Original token0 was sortedToken0
            finalAmount0 = amount0Sorted;
            finalAmount1 = amount1Sorted;
        } else {
            // Original token0 was sortedToken1 (meaning order was swapped)
            finalAmount0 = amount1Sorted;
            finalAmount1 = amount0Sorted;
        }
        
        // const currentSqrtPriceX96 = JSBI.BigInt(slot0.sqrtPriceX96); // This was based on the old slot0 object structure

        // Calculate human-readable prices of original token1Symbol in terms of original token0Symbol
        const priceOfReqToken1InReqToken0_Current = calculatePriceString(
            currentSqrtPriceX96_JSBI, // Pass the JSBI object from slot0
            sortedToken0, 
            sortedToken1, 
            sdkToken1, // Price OF this token (e.g. BTCRL)
            sdkToken0,  // Price IN TERMS OF this token (e.g. YUSDC)
            "currentPrice" // context
        );

        const priceOfReqToken1InReqToken0_Lower = calculatePriceString(
            TickMath.getSqrtRatioAtTick(tickLower),
            sortedToken0, 
            sortedToken1, 
            sdkToken1, 
            sdkToken0,
            "priceAtTickLower" // context
        );

        const priceOfReqToken1InReqToken0_Upper = calculatePriceString(
            TickMath.getSqrtRatioAtTick(tickUpper),
            sortedToken0, 
            sortedToken1, 
            sdkToken1, 
            sdkToken0,
            "priceAtTickUpper" // context
        );

        res.status(200).json({
            liquidity: liquidity,
            finalTickLower: tickLower,
            finalTickUpper: tickUpper,
            amount0: finalAmount0, 
            amount1: finalAmount1, 
            currentPoolTick: currentTickFromSlot0, // Return the tick from slot0 directly
            currentPrice: priceOfReqToken1InReqToken0_Current,
            priceAtTickLower: priceOfReqToken1InReqToken0_Lower,
            priceAtTickUpper: priceOfReqToken1InReqToken0_Upper,
        });

    } catch (error: any) {
        console.error("API Error (calculate-liquidity-parameters):", error);
        res.status(500).json({ 
            message: error.message || "An unexpected error occurred during liquidity calculation.",
            error: process.env.NODE_ENV === 'development' ? error : undefined // Provide more error details in dev
        });
    }
} 