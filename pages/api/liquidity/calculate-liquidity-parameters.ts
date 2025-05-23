import { Token, Price } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, PoolKey } from "@uniswap/v4-sdk"; 
import { TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi";
import { TOKEN_DEFINITIONS, TokenSymbol } from "../../../lib/swap-constants";
import { publicClient } from "../../../lib/viemClient"; 
import { 
    parseUnits, 
    isAddress, 
    getAddress, 
    parseAbi, 
    type Hex 
} from "viem";

// Contract addresses & constants (ensure these are appropriate for the chainId being used)
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4"); 
const DEFAULT_HOOK_ADDRESS = getAddress("0x94ba380a340E020Dc29D7883f01628caBC975000"); 
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_FEE = 8388608; 
const DEFAULT_TICK_SPACING = 60;
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

interface CalculateLiquidityParamsRequest extends NextApiRequest {
    body: {
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        inputAmount: string;      
        inputTokenSymbol: TokenSymbol; 
        userTickLower: number;
        userTickUpper: number;
        chainId: number; 
        // userAddress is not strictly needed for pure calculation, but good for future use if needed
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
    poolSortedToken0: Token, // Token that sorts first by address (e.g., BTCRL)
    poolSortedToken1: Token, // Token that sorts second by address (e.g., YUSDC)
    desiredPriceOfToken: Token, // The token WE WANT THE PRICE OF
    desiredPriceInToken: Token  // The token WE WANT THE PRICE IN TERMS OF
): string {
    // sqrtPriceX96_JSBI from the pool is sqrt(poolSortedToken1_amount_smallest_units / poolSortedToken0_amount_smallest_units) * 2^96
    // So, (sqrtPriceX96_JSBI / 2^96)^2 = poolSortedToken1_amount_smallest_units / poolSortedToken0_amount_smallest_units
    // Let this raw ratio be R_raw = (poolSortedToken1_units / poolSortedToken0_units)

    // Numerator and denominator for the R_raw ratio:
    const R_raw_numerator = JSBI.multiply(sqrtPriceX96_JSBI, sqrtPriceX96_JSBI); // Corresponds to poolSortedToken1 units
    const R_raw_denominator = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(192)); // Corresponds to poolSortedToken0 units

    console.log(`[API] Calculated R_raw_numerator (poolT1 units part): ${R_raw_numerator.toString()}`);
    console.log(`[API] Calculated R_raw_denominator (poolT0 units part): ${R_raw_denominator.toString()}`);
    // R_raw = R_raw_numerator / R_raw_denominator is a small number (e.g., YUSDC/BTCRL ~1e-9)

    let priceToFormat: Price<Token, Token>;

    // Price constructor: new Price(baseCurrency, quoteCurrency, denominator_raw_amount_of_base, numerator_raw_amount_of_quote)
    // The price is (numerator_raw_amount_of_quote / denominator_raw_amount_of_base) units of quoteCurrency per unit of baseCurrency.

    if (desiredPriceOfToken.equals(poolSortedToken1) && desiredPriceInToken.equals(poolSortedToken0)) {
        // We want Price of poolSortedToken1 (e.g., YUSDC) in terms of poolSortedToken0 (e.g., BTCRL)
        // Base: poolSortedToken1 (YUSDC). Quote: poolSortedToken0 (BTCRL).
        // We need raw_BTCRL_amount / raw_YUSDC_amount. This is 1 / R_raw.
        // raw_YUSDC_amount = R_raw_numerator
        // raw_BTCRL_amount = R_raw_denominator
        priceToFormat = new Price(
            poolSortedToken1,     // Base currency (YUSDC)
            poolSortedToken0,     // Quote currency (BTCRL)
            R_raw_numerator,      // Denominator: raw amount of base (YUSDC units)
            R_raw_denominator     // Numerator: raw amount of quote (BTCRL units)
        );
        console.log(`[API] Price of ${poolSortedToken1.symbol} in ${poolSortedToken0.symbol} (using R_raw_den/R_raw_num): ${priceToFormat.toSignificant(18)}`);

    } else if (desiredPriceOfToken.equals(poolSortedToken0) && desiredPriceInToken.equals(poolSortedToken1)) {
        // We want Price of poolSortedToken0 (e.g., BTCRL) in terms of poolSortedToken1 (e.g., YUSDC)
        // Base: poolSortedToken0 (BTCRL). Quote: poolSortedToken1 (YUSDC).
        // We need raw_YUSDC_amount / raw_BTCRL_amount. This is R_raw.
        // raw_BTCRL_amount = R_raw_denominator
        // raw_YUSDC_amount = R_raw_numerator
        priceToFormat = new Price(
            poolSortedToken0,     // Base currency (BTCRL)
            poolSortedToken1,     // Quote currency (YUSDC)
            R_raw_denominator,    // Denominator: raw amount of base (BTCRL units)
            R_raw_numerator     // Numerator: raw amount of quote (YUSDC units)
        );
        console.log(`[API] Price of ${poolSortedToken0.symbol} in ${poolSortedToken1.symbol} (using R_raw_num/R_raw_den): ${priceToFormat.toSignificant(18)}`);
    } else {
        console.warn(`[API] Price calculation: Desired pair (${desiredPriceOfToken.symbol}/${desiredPriceInToken.symbol}) does not directly match sorted pool pair (${poolSortedToken0.symbol}/${poolSortedToken1.symbol}) or its inverse. This indicates a potential logic issue in the calling code or token definitions.`);
        // Fallback to a default or error state; for now, trying to construct with desired tokens directly,
        // but this might not be meaningful if sqrtPriceX96 isn't for this exact pair.
        // This path should ideally not be taken.
        priceToFormat = new Price(desiredPriceOfToken, desiredPriceInToken, JSBI.BigInt(1), JSBI.BigInt(1)); // Placeholder 1:1 price
        return "ErrorInPriceCalc";
    }
    
    const result = priceToFormat.toSignificant(8); // Use 8 for more precision in UI if needed
    console.log(`[API] Final calculated price string for ${desiredPriceOfToken.symbol}/${desiredPriceInToken.symbol}: ${result}`);
    return result;
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
            chainId,
            // userAddress // Not used in this version but available
        } = req.body;

        // --- Input Validation ---
        if (!TOKEN_DEFINITIONS[token0Symbol] || !TOKEN_DEFINITIONS[token1Symbol] || !TOKEN_DEFINITIONS[inputTokenSymbol]) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }
        if (isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
            return res.status(400).json({ message: "Invalid inputAmount." });
        }
        if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
            return res.status(400).json({ message: "userTickLower and userTickUpper must be numbers." });
        }
        if (userTickLower >= userTickUpper) {
            return res.status(400).json({ message: "userTickLower must be less than userTickUpper." });
        }
        // TODO: Add more validation for chainId, perhaps ensure it matches a configured supported ID

        const token0Config = TOKEN_DEFINITIONS[token0Symbol];
        const token1Config = TOKEN_DEFINITIONS[token1Symbol];

        // --- SDK Token Objects (using original symbols first) ---
        // console.log("[API] Creating Token0 with", { symbol: token0Symbol, addressRaw: token0Config.addressRaw });
        const sdkToken0Original = new Token(chainId, getAddress(token0Config.addressRaw), token0Config.decimals, token0Config.symbol);
        // console.log("[API] Successfully created Token0.", sdkToken0Original);

        // console.log("[API] Creating Token1 with", { symbol: token1Symbol, addressRaw: token1Config.addressRaw });
        const sdkToken1Original = new Token(chainId, getAddress(token1Config.addressRaw), token1Config.decimals, token1Config.symbol);
        // console.log("[API] Successfully created Token1.", sdkToken1Original);

        const inputTokenConfig = TOKEN_DEFINITIONS[inputTokenSymbol];
        // console.log("[API] Creating InputToken with", { symbol: inputTokenSymbol, addressRaw: inputTokenConfig.addressRaw });
        const sdkInputToken = new Token(chainId, getAddress(inputTokenConfig.addressRaw), inputTokenConfig.decimals, inputTokenConfig.symbol);
        // console.log("[API] Successfully created InputToken.", sdkInputToken);

        const parsedInputAmount = parseUnits(inputAmount, sdkInputToken.decimals);

        // --- Tick Alignment ---
        const clampedUserTickLower = Math.max(userTickLower, SDK_MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, SDK_MAX_TICK);
        const finalTickLower = Math.ceil(clampedUserTickLower / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
        const finalTickUpper = Math.floor(clampedUserTickUpper / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;

        if (finalTickLower >= finalTickUpper) {
            return res.status(400).json({ message: `Error: finalTickLower (${finalTickLower}) must be less than finalTickUpper (${finalTickUpper}) after alignment.` });
        }

        // --- Token Sorting (Crucial for V4 SDK) ---
        // Use sdkToken0Original and sdkToken1Original for sorting to maintain consistency with how poolId would be derived
        const [sortedSdkToken0, sortedSdkToken1] = sdkToken0Original.sortsBefore(sdkToken1Original) 
            ? [sdkToken0Original, sdkToken1Original] 
            : [sdkToken1Original, sdkToken0Original];
        
        // Pool ID for fetching slot0 (consistent with prepare-mint-tx)
        const poolKey: PoolKey = {
            currency0: sortedSdkToken0.address as `0x${string}`,
            currency1: sortedSdkToken1.address as `0x${string}`,
            fee: DEFAULT_FEE,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: DEFAULT_HOOK_ADDRESS
        };
        const poolId = V4Pool.getPoolId(sortedSdkToken0, sortedSdkToken1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks);

        // Log Pool ID and State View Address before fetching slot0
        console.log("[API DEBUG] Derived Pool ID:", poolId);
        console.log("[API DEBUG] State View Address:", STATE_VIEW_ADDRESS);

        // --- Fetch Pool Slot0 ---
        let slot0;
        try {
            console.log("[API DEBUG] Calling getSlot0 with Pool ID:", poolId);
            const slot0DataViem = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbiViem,
                functionName: 'getSlot0',
                args: [poolId as Hex]
            }) as readonly [bigint, number, number, number]; // [sqrtPriceX96, tick, protocolFee, lpFee]

            slot0 = {
                sqrtPriceX96: slot0DataViem[0].toString(),
                tick: Number(slot0DataViem[1]),
                lpFee: Number(slot0DataViem[3]) 
            };
        } catch (error) {
            console.error("API Error (calculate-liquidity-parameters) fetching pool slot0 data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data for calculation.", error });
        }

        // Log raw slot0 data after fetching
        console.log("[API DEBUG] Raw slot0 data fetched:", slot0);

        // --- Create V4Pool for Calculation ---
        const v4PoolForCalc = new V4Pool(
            sortedSdkToken0,
            sortedSdkToken1,
            slot0.lpFee, 
            DEFAULT_TICK_SPACING,
            ETHERS_ADDRESS_ZERO as `0x${string}`, // hooks not strictly needed for calc if only using fromAmount0/1
            slot0.sqrtPriceX96,
            JSBI.BigInt(0), // currentLiquidity, not strictly needed for fromAmount0/1
            slot0.tick
        );

        // --- Calculate Position based on inputTokenSymbol ---
        let positionForCalc: V4Position;
        
        // Determine if the input token (sdkInputToken) is the same as sortedSdkToken0
        if (sdkInputToken.address === sortedSdkToken0.address) {
            positionForCalc = V4Position.fromAmount0({
                pool: v4PoolForCalc,
                tickLower: finalTickLower,
                tickUpper: finalTickUpper,
                amount0: JSBI.BigInt(parsedInputAmount.toString()),
                useFullPrecision: true
            });
        } else { // Input token must be sortedSdkToken1
            positionForCalc = V4Position.fromAmount1({
                pool: v4PoolForCalc,
                tickLower: finalTickLower,
                tickUpper: finalTickUpper,
                amount1: JSBI.BigInt(parsedInputAmount.toString())
            });
        }
        
        const calculatedLiquidity = positionForCalc.liquidity.toString();
        // These are amounts for sortedSdkToken0 and sortedSdkToken1
        const calculatedAmountSorted0 = positionForCalc.mintAmounts.amount0.toString(); 
        const calculatedAmountSorted1 = positionForCalc.mintAmounts.amount1.toString();

        // --- Map calculated amounts back to original token0Symbol and token1Symbol ---
        let finalAmount0: string;
        let finalAmount1: string;

        if (sdkToken0Original.address === sortedSdkToken0.address) {
            // Original token0 was sortedToken0
            finalAmount0 = calculatedAmountSorted0;
            finalAmount1 = calculatedAmountSorted1;
        } else {
            // Original token0 was sortedToken1 (meaning order was swapped)
            finalAmount0 = calculatedAmountSorted1;
            finalAmount1 = calculatedAmountSorted0;
        }
        
        const currentSqrtPriceX96 = JSBI.BigInt(slot0.sqrtPriceX96);
        const sqrtPriceX96AtTickLower = TickMath.getSqrtRatioAtTick(finalTickLower);
        const sqrtPriceX96AtTickUpper = TickMath.getSqrtRatioAtTick(finalTickUpper);

        // Calculate human-readable prices of original token1Symbol in terms of original token0Symbol
        console.log("[API] Calculating Current Price String...");
        console.log("[API] Inputs to calculatePriceString - current:", { 
            sqrtPriceX96_Value: currentSqrtPriceX96.toString(),
            poolSortedToken0: sortedSdkToken0, 
            poolSortedToken1: sortedSdkToken1, 
            desiredPriceOfToken: sdkToken1Original, 
            desiredPriceInToken: sdkToken0Original 
        });
        const priceOfReqToken1InReqToken0_Current = calculatePriceString(
            currentSqrtPriceX96,
            sortedSdkToken0, 
            sortedSdkToken1, 
            sdkToken1Original, // Price OF this token (e.g. BTCRL)
            sdkToken0Original  // Price IN TERMS OF this token (e.g. YUSDC)
        );
        console.log("[API] Calculated Current Price String:", priceOfReqToken1InReqToken0_Current);

        console.log("[API] Calculating Price String at Tick Lower...");
        console.log("[API] Inputs to calculatePriceString - lower:", { 
            sqrtPriceX96_Value: sqrtPriceX96AtTickLower.toString(),
            poolSortedToken0: sortedSdkToken0, 
            poolSortedToken1: sortedSdkToken1, 
            desiredPriceOfToken: sdkToken1Original, 
            desiredPriceInToken: sdkToken0Original 
        });
        const priceOfReqToken1InReqToken0_Lower = calculatePriceString(
            sqrtPriceX96AtTickLower,
            sortedSdkToken0, 
            sortedSdkToken1, 
            sdkToken1Original, 
            sdkToken0Original
        );
         console.log("[API] Calculated Price String at Tick Lower:", priceOfReqToken1InReqToken0_Lower);

        console.log("[API] Calculating Price String at Tick Upper...");
         console.log("[API] Inputs to calculatePriceString - upper:", { 
            sqrtPriceX96_Value: sqrtPriceX96AtTickUpper.toString(),
            poolSortedToken0: sortedSdkToken0, 
            poolSortedToken1: sortedSdkToken1, 
            desiredPriceOfToken: sdkToken1Original, 
            desiredPriceInToken: sdkToken0Original 
        });
        const priceOfReqToken1InReqToken0_Upper = calculatePriceString(
            sqrtPriceX96AtTickUpper,
            sortedSdkToken0, 
            sortedSdkToken1, 
            sdkToken1Original, 
            sdkToken0Original
        );
        console.log("[API] Calculated Price String at Tick Upper:", priceOfReqToken1InReqToken0_Upper);

        res.status(200).json({
            liquidity: calculatedLiquidity,
            finalTickLower: finalTickLower,
            finalTickUpper: finalTickUpper,
            amount0: finalAmount0, 
            amount1: finalAmount1, 
            currentPoolTick: slot0.tick,
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