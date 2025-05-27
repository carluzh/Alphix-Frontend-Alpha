import { Token, Price } from '@uniswap/sdk-core';
import { Pool as V4Pool, PoolKey } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi";
import { TOKEN_DEFINITIONS, TokenSymbol } from "../../../lib/swap-constants";
import { publicClient } from "../../../lib/viemClient";
import {
    isAddress,
    getAddress,
    parseAbi,
    type Hex
} from "viem";

// Contract addresses & constants
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4"); // Ensure this is correct
const DEFAULT_HOOK_ADDRESS = getAddress("0x94ba380a340E020Dc29D7883f01628caBC975000"); // Ensure this is correct
const DEFAULT_FEE = 8388608; // Uniswap V4 default pool fee
const DEFAULT_TICK_SPACING = 60; // Uniswap V4 default tick spacing

interface GetPoolStateRequest extends NextApiRequest {
    body: {
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        chainId: number;
    };
}

interface GetPoolStateResponse {
    currentPoolTick: number;
    currentPrice: string; // Price of token1Symbol in terms of token0Symbol
    sqrtPriceX96: string;
}

type ApiResponse = GetPoolStateResponse | { message: string; error?: any };

// Helper function to calculate price of tokenB in terms of tokenA from a sqrtPriceX96
// (Copied and adapted from calculate-liquidity-parameters.ts)
function calculatePriceString(
    sqrtPriceX96_JSBI: JSBI,
    poolSortedToken0: Token,
    poolSortedToken1: Token,
    desiredPriceOfToken: Token, // The token WE WANT THE PRICE OF (e.g. original Token1)
    desiredPriceInToken: Token, // The token WE WANT THE PRICE IN TERMS OF (e.g. original Token0)
    callContext: string
): string {
    // console.log(`\\n[calculatePriceString CALLED - Context: ${callContext}]`);
    // console.log(`  Input sqrtPriceX96: ${sqrtPriceX96_JSBI.toString()}`);
    // console.log(`  poolSortedToken0: ${poolSortedToken0.symbol} (Decimals: ${poolSortedToken0.decimals}, Address: ${poolSortedToken0.address})`);
    // console.log(`  poolSortedToken1: ${poolSortedToken1.symbol} (Decimals: ${poolSortedToken1.decimals}, Address: ${poolSortedToken1.address})`);
    // console.log(`  desiredPriceOfToken: ${desiredPriceOfToken.symbol} (Decimals: ${desiredPriceOfToken.decimals}, Address: ${desiredPriceOfToken.address})`);
    // console.log(`  desiredPriceInToken: ${desiredPriceInToken.symbol} (Decimals: ${desiredPriceInToken.decimals}, Address: ${desiredPriceInToken.address})`);

    const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
    const raw_Ratio_Numerator = JSBI.multiply(sqrtPriceX96_JSBI, sqrtPriceX96_JSBI);
    const raw_Ratio_Denominator = JSBI.multiply(Q96, Q96);

    const price_Sorted1_Per_Sorted0 = new Price(
        poolSortedToken0,
        poolSortedToken1,
        raw_Ratio_Denominator, // Denominator: raw amount of poolSortedToken0 (base)
        raw_Ratio_Numerator    // Numerator: raw amount of poolSortedToken1 (quote)
    );
    // console.log(`  Intermediate calculated price_Sorted1_Per_Sorted0: ${price_Sorted1_Per_Sorted0.toSignificant(18)}`);

    let finalPriceObject: Price<Token, Token>;

    if (desiredPriceOfToken.equals(poolSortedToken1) && desiredPriceInToken.equals(poolSortedToken0)) {
        // We want Price of poolSortedToken1 in terms of poolSortedToken0
        // console.log("  Branch: Desired Price of poolSortedToken1 in terms of poolSortedToken0. Using direct intermediate price.");
        finalPriceObject = price_Sorted1_Per_Sorted0;
    } else if (desiredPriceOfToken.equals(poolSortedToken0) && desiredPriceInToken.equals(poolSortedToken1)) {
        // We want Price of poolSortedToken0 in terms of poolSortedToken1
        // console.log("  Branch: Desired Price of poolSortedToken0 in terms of poolSortedToken1. Inverting intermediate price.");
        finalPriceObject = price_Sorted1_Per_Sorted0.invert();
    } else {
        // This case should ideally be handled by ensuring desiredPriceOfToken and desiredPriceInToken
        // match one of the original tokens passed to the API (e.g. reqToken0Symbol, reqToken1Symbol)
        // and then mapping them correctly to poolSortedToken0/1.
        // For this specific API (get-pool-state), we are always calculating price of original reqToken1 in terms of original reqToken0.
        // The `desiredPriceOfToken` will be the original token1, `desiredPriceInToken` the original token0.
        // So one of the above branches should always match IF originalToken0/1 correctly map to poolSortedToken0/1.

        // If original token0 was sorted to be poolSortedToken0, and original token1 was poolSortedToken1:
        // Then desiredPriceOfToken (orig t1) = poolSortedToken1, desiredPriceInToken (orig t0) = poolSortedToken0. (Matches first branch)

        // If original token0 was sorted to be poolSortedToken1, and original token1 was poolSortedToken0:
        // Then desiredPriceOfToken (orig t1) = poolSortedToken0, desiredPriceInToken (orig t0) = poolSortedToken1. (Matches second branch)
        
        console.warn(`  [calculatePriceString - ${callContext}] Desired pair (${desiredPriceOfToken.symbol}/${desiredPriceInToken.symbol}) logic error relative to sorted pool pair (${poolSortedToken0.symbol}/${poolSortedToken1.symbol}).`);
        return "ErrorInPriceCalcLogic";
    }
    
    const finalResult = finalPriceObject.toSignificant(8); // Using 8 significant digits for display
    // console.log(`  Final formatted price string (toSignificant(8)): ${finalResult}`);
    // console.log(`[calculatePriceString END - Context: ${callContext}]\n`);
    return finalResult;
}


export default async function handler(
    req: GetPoolStateRequest,
    res: NextApiResponse<ApiResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    try {
        const {
            token0Symbol, // This is the token the user thinks of as "token0" (e.g. YUSDC)
            token1Symbol, // This is the token the user thinks of as "token1" (e.g. BTCRL)
            chainId,
        } = req.body;

        // --- Input Validation ---
        if (!TOKEN_DEFINITIONS[token0Symbol] || !TOKEN_DEFINITIONS[token1Symbol]) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }
        // TODO: Add validation for chainId

        const token0Config = TOKEN_DEFINITIONS[token0Symbol];
        const token1Config = TOKEN_DEFINITIONS[token1Symbol];

        // --- SDK Token Objects (using original symbols from request) ---
        const sdkToken0Req = new Token(chainId, getAddress(token0Config.addressRaw), token0Config.decimals, token0Config.symbol);
        const sdkToken1Req = new Token(chainId, getAddress(token1Config.addressRaw), token1Config.decimals, token1Config.symbol);

        // --- Token Sorting (Crucial for V4 SDK pool key) ---
        const [sortedSdkToken0, sortedSdkToken1] = sdkToken0Req.sortsBefore(sdkToken1Req)
            ? [sdkToken0Req, sdkToken1Req]
            : [sdkToken1Req, sdkToken0Req];

        const poolKey: PoolKey = {
            currency0: sortedSdkToken0.address as `0x${string}`,
            currency1: sortedSdkToken1.address as `0x${string}`,
            fee: DEFAULT_FEE,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: DEFAULT_HOOK_ADDRESS
        };
        const poolId = V4Pool.getPoolId(sortedSdkToken0, sortedSdkToken1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks);

        // --- Fetch Pool Slot0 ---
        let slot0;
        try {
            const slot0DataViem = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbiViem,
                functionName: 'getSlot0',
                args: [poolId as Hex]
            }) as readonly [bigint, number, number, number]; // [sqrtPriceX96, tick, protocolFee, lpFee]

            slot0 = {
                sqrtPriceX96_JSBI: JSBI.BigInt(slot0DataViem[0].toString()),
                tick: Number(slot0DataViem[1]),
                // lpFee: Number(slot0DataViem[3]) // Not strictly needed for this API
            };
        } catch (error) {
            console.error("API Error (get-pool-state) fetching pool slot0 data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data.", error });
        }

        // Calculate human-readable price of original/requested token1Symbol in terms of original/requested token0Symbol
        const priceOfReqToken1InReqToken0 = calculatePriceString(
            slot0.sqrtPriceX96_JSBI,
            sortedSdkToken0,      // Pool's sorted token0
            sortedSdkToken1,      // Pool's sorted token1
            sdkToken1Req,         // We want the price OF this token (original request token1)
            sdkToken0Req,         // We want the price IN TERMS OF this token (original request token0)
            "currentPriceForPoolState"
        );

        if (priceOfReqToken1InReqToken0 === "ErrorInPriceCalcLogic") {
            return res.status(500).json({ message: "Internal error calculating price."});
        }

        res.status(200).json({
            currentPoolTick: slot0.tick,
            currentPrice: priceOfReqToken1InReqToken0,
            sqrtPriceX96: slot0.sqrtPriceX96_JSBI.toString(),
        });

    } catch (error: any) {
        console.error("API Error (get-pool-state):", error);
        res.status(500).json({
            message: error.message || "An unexpected error occurred while fetching pool state.",
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
} 