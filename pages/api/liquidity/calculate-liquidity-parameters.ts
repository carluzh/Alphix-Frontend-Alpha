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
    desiredPriceInToken: Token,  // The token WE WANT THE PRICE IN TERMS OF
    callContext: string // Added for logging context e.g., "currentPrice", "priceAtTickLower"
): string {
    console.log(`\\n[calculatePriceString CALLED - Context: ${callContext}]`);
    console.log(`  Input sqrtPriceX96: ${sqrtPriceX96_JSBI.toString()}`);
    console.log(`  poolSortedToken0: ${poolSortedToken0.symbol} (Decimals: ${poolSortedToken0.decimals}, Address: ${poolSortedToken0.address})`);
    console.log(`  poolSortedToken1: ${poolSortedToken1.symbol} (Decimals: ${poolSortedToken1.decimals}, Address: ${poolSortedToken1.address})`);
    console.log(`  desiredPriceOfToken: ${desiredPriceOfToken.symbol} (Decimals: ${desiredPriceOfToken.decimals}, Address: ${desiredPriceOfToken.address})`);
    console.log(`  desiredPriceInToken: ${desiredPriceInToken.symbol} (Decimals: ${desiredPriceInToken.decimals}, Address: ${desiredPriceInToken.address})`);

    // poolSortedToken0 is BTCRL (decimals 8)
    // poolSortedToken1 is YUSDC (decimals 6)
    // sqrtPriceX96_JSBI corresponds to sqrt(YUSDC_raw_units / BTCRL_raw_units) * 2^96

    const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));

    // Numerator for (YUSDC_raw_units / BTCRL_raw_units) ratio is sqrtPriceX96_JSBI^2
    // Denominator for (YUSDC_raw_units / BTCRL_raw_units) ratio is (2^96)^2
    const raw_YUSDC_units_part = JSBI.multiply(sqrtPriceX96_JSBI, sqrtPriceX96_JSBI);
    const raw_BTCRL_units_part = JSBI.multiply(Q96, Q96);

    // Price<poolSortedToken0, poolSortedToken1> means Price of poolSortedToken1 (YUSDC) in terms of poolSortedToken0 (BTCRL)
    // Constructor: new Price(baseCurrency, quoteCurrency, denominator_raw_amount_of_base, numerator_raw_amount_of_quote)
    const price_YUSDC_per_BTCRL = new Price(
        poolSortedToken0, // Base currency: BTCRL
        poolSortedToken1, // Quote currency: YUSDC
        raw_BTCRL_units_part, // Denominator: raw amount of BTCRL (base)
        raw_YUSDC_units_part  // Numerator: raw amount of YUSDC (quote)
    );
    console.log(`  Intermediate calculated price_YUSDC_per_BTCRL: ${price_YUSDC_per_BTCRL.toSignificant(18)}`);

    let finalPriceObject: Price<Token, Token>;

    if (desiredPriceOfToken.equals(poolSortedToken1) && desiredPriceInToken.equals(poolSortedToken0)) {
        // We want Price of poolSortedToken1 (YUSDC) in terms of poolSortedToken0 (BTCRL)
        console.log("  Branch: Desired Price of YUSDC in terms of BTCRL. Using direct intermediate price.");
        finalPriceObject = price_YUSDC_per_BTCRL;
    } else if (desiredPriceOfToken.equals(poolSortedToken0) && desiredPriceInToken.equals(poolSortedToken1)) {
        // We want Price of poolSortedToken0 (BTCRL) in terms of poolSortedToken1 (YUSDC)
        console.log("  Branch: Desired Price of BTCRL in terms of YUSDC. Inverting intermediate price.");
        finalPriceObject = price_YUSDC_per_BTCRL.invert();
    } else {
        console.warn(`  [calculatePriceString - ${callContext}] Desired pair (${desiredPriceOfToken.symbol}/${desiredPriceInToken.symbol}) does not directly match sorted pool pair.`);
        return "ErrorInPriceCalcLogic";
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
        let rawSqrtPriceX96String: string;
        let currentTickFromSlot0: number;
        let lpFeeFromSlot0: number;
        let currentSqrtPriceX96_JSBI: JSBI;

        try {
            console.log("[API DEBUG] Calling getSlot0 with Pool ID:", poolId);
            const slot0DataViem = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbiViem,
                functionName: 'getSlot0',
                args: [poolId as Hex]
            }) as readonly [bigint, number, number, number]; // [sqrtPriceX96, tick, protocolFee, lpFee]

            rawSqrtPriceX96String = slot0DataViem[0].toString();
            currentTickFromSlot0 = Number(slot0DataViem[1]);
            lpFeeFromSlot0 = Number(slot0DataViem[3]); 
            currentSqrtPriceX96_JSBI = JSBI.BigInt(rawSqrtPriceX96String);

        } catch (error) {
            console.error("API Error (calculate-liquidity-parameters) fetching pool slot0 data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data for calculation.", error });
        }

        // Log raw slot0 data after fetching
        console.log("[API DEBUG] Raw slot0 data processed:", { rawSqrtPriceX96String, currentTickFromSlot0, lpFeeFromSlot0 });

        // --- Create V4Pool for Calculation ---
        const v4PoolForCalc = new V4Pool(
            sortedSdkToken0,
            sortedSdkToken1,
            lpFeeFromSlot0, 
            DEFAULT_TICK_SPACING,
            ETHERS_ADDRESS_ZERO as `0x${string}`, 
            currentSqrtPriceX96_JSBI, // Use JSBI instance
            JSBI.BigInt(0), 
            currentTickFromSlot0 // Use numeric tick
        );

        console.log(`  Input Token: ${inputTokenSymbol} (${sdkInputToken.address}), Parsed Amount: ${parsedInputAmount.toString()}`);
        console.log(`  Sorted Token0: ${sortedSdkToken0.symbol} (${sortedSdkToken0.address})`);
        console.log(`  Sorted Token1: ${sortedSdkToken1.symbol} (${sortedSdkToken1.address})`);
        console.log(`  Pool Current Tick from v4PoolForCalc: ${v4PoolForCalc.tickCurrent}`); // From constructed pool
        console.log(`  Pool SqrtPriceX96 from v4PoolForCalc: ${v4PoolForCalc.sqrtRatioX96.toString()}`); // From constructed pool
        console.log(`  Final Tick Lower: ${finalTickLower}, Final Tick Upper: ${finalTickUpper}`);

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

        // Check for impractically large calculated amounts before proceeding
        const MAX_REASONABLE_AMOUNT_STR_LEN = 70; // Heuristic: numbers like 1e+69 are usually > 70 chars
        let parsedCalcAmount0: bigint;
        let parsedCalcAmount1: bigint;

        try {
            parsedCalcAmount0 = BigInt(calculatedAmountSorted0);
            parsedCalcAmount1 = BigInt(calculatedAmountSorted1);
        } catch (e) {
            console.error("[API calc-params] Error parsing SDK mintAmounts to BigInt. Values:", calculatedAmountSorted0, calculatedAmountSorted1);
            return res.status(400).json({
                message: "Calculated token amounts from SDK are not valid numbers (e.g., contains \"e+\"). This may be due to an extremely narrow price range for the input amount.",
                error: "SDK amount parsing error"
            });
        }
        
        // Check if parsed amounts exceed a practical limit (e.g. maxUint256, though amounts should be much smaller)
        // This catches cases where the SDK might return an absurdly large number for one token amount due to a tiny range.
        const MAX_UINT_256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
        if (parsedCalcAmount0 > MAX_UINT_256 || parsedCalcAmount1 > MAX_UINT_256) {
            console.warn("[API calc-params] Impractically large BigInt amount from SDK. A0:", parsedCalcAmount0.toString(), "A1:", parsedCalcAmount1.toString());
             return res.status(400).json({
                message: "Calculated dependent token amount is astronomically large (exceeds max representable values for tokens) for the selected price range and input amount. Please widen the price range or reduce the input amount.",
                error: "Impractical dependent amount (overflow-like)"
            });
        }
        // The previous string length check can be a secondary heuristic if needed, but BigInt comparison is more direct.
        // if (calculatedAmountSorted0.length > MAX_REASONABLE_AMOUNT_STR_LEN || calculatedAmountSorted1.length > MAX_REASONABLE_AMOUNT_STR_LEN) {
        //     console.warn("[API calc-params] Impractically large calculated amount string from SDK for range/input. A0:", calculatedAmountSorted0, "A1:", calculatedAmountSorted1);
        //     return res.status(400).json({
        //         message: "Calculated dependent token amount is impractically large for the selected price range and input amount. Please widen the price range or reduce the input amount.",
        //         error: "Impractical dependent amount"
        //     });
        // }

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
        
        // const currentSqrtPriceX96 = JSBI.BigInt(slot0.sqrtPriceX96); // This was based on the old slot0 object structure

        // Calculate human-readable prices of original token1Symbol in terms of original token0Symbol
        console.log("[API] Calculating Current Price String using currentSqrtPriceX96_JSBI...");
        console.log("[API] Inputs to calculatePriceString - current:", { 
            sqrtPriceX96_Value: currentSqrtPriceX96_JSBI.toString(),
            poolSortedToken0: sortedSdkToken0, 
            poolSortedToken1: sortedSdkToken1, 
            desiredPriceOfToken: sdkToken1Original, 
            desiredPriceInToken: sdkToken0Original 
        });
        const priceOfReqToken1InReqToken0_Current = calculatePriceString(
            currentSqrtPriceX96_JSBI, // Pass the JSBI object from slot0
            sortedSdkToken0, 
            sortedSdkToken1, 
            sdkToken1Original, // Price OF this token (e.g. BTCRL)
            sdkToken0Original,  // Price IN TERMS OF this token (e.g. YUSDC)
            "currentPrice" // context
        );
        console.log("[API] Calculated Current Price String:", priceOfReqToken1InReqToken0_Current);

        console.log("[API] Calculating Price String at Tick Lower...");
        console.log("[API] Inputs to calculatePriceString - lower:", { 
            sqrtPriceX96_Value: TickMath.getSqrtRatioAtTick(finalTickLower).toString(),
            poolSortedToken0: sortedSdkToken0, 
            poolSortedToken1: sortedSdkToken1, 
            desiredPriceOfToken: sdkToken1Original, 
            desiredPriceInToken: sdkToken0Original 
        });
        const priceOfReqToken1InReqToken0_Lower = calculatePriceString(
            TickMath.getSqrtRatioAtTick(finalTickLower),
            sortedSdkToken0, 
            sortedSdkToken1, 
            sdkToken1Original, 
            sdkToken0Original,
            "priceAtTickLower" // context
        );
         console.log("[API] Calculated Price String at Tick Lower:", priceOfReqToken1InReqToken0_Lower);

        console.log("[API] Calculating Price String at Tick Upper...");
         console.log("[API] Inputs to calculatePriceString - upper:", { 
            sqrtPriceX96_Value: TickMath.getSqrtRatioAtTick(finalTickUpper).toString(),
            poolSortedToken0: sortedSdkToken0, 
            poolSortedToken1: sortedSdkToken1, 
            desiredPriceOfToken: sdkToken1Original, 
            desiredPriceInToken: sdkToken0Original 
        });
        const priceOfReqToken1InReqToken0_Upper = calculatePriceString(
            TickMath.getSqrtRatioAtTick(finalTickUpper),
            sortedSdkToken0, 
            sortedSdkToken1, 
            sdkToken1Original, 
            sdkToken0Original,
            "priceAtTickUpper" // context
        );
        console.log("[API] Calculated Price String at Tick Upper:", priceOfReqToken1InReqToken0_Upper);

        res.status(200).json({
            liquidity: calculatedLiquidity,
            finalTickLower: finalTickLower,
            finalTickUpper: finalTickUpper,
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