import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseAbi, type Hex } from "viem";
import { getToken, getPoolByTokens } from "../../../lib/pools-config";
import { TokenSymbol } from "../../../lib/swap-constants";
import { publicClient } from "../../../lib/viemClient";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';

const POOL_MANAGER_ADDRESS = getAddress("0x0000000000000000000000000000000000000000"); // Replace with actual PoolManager address
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4");

interface InitializePoolRequest extends NextApiRequest {
    body: {
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        chainId: number;
    };
}

interface InitializePoolResponse {
    isInitialized: boolean;
    needsInitialization?: boolean;
    message: string;
    poolId?: string;
    initializeTransaction?: {
        to: string;
        data: string;
        value: string;
    };
}

export default async function handler(
    req: InitializePoolRequest,
    res: NextApiResponse<InitializePoolResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed`, isInitialized: false });
    }

    try {
        const { token0Symbol, token1Symbol, chainId } = req.body;

        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);

        if (!token0Config || !token1Config) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided.", isInitialized: false });
        }

        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${token0Symbol}/${token1Symbol}`, isInitialized: false });
        }

        const poolId = poolConfig.subgraphId;
        console.log(`[POOL INIT] Checking initialization status for pool: ${poolId}`);

        // Check if pool is initialized by trying to get slot0 data
        const stateViewAbi = parseAbi([
            'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)'
        ]);

        try {
            const slot0Data = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbi,
                functionName: 'getSlot0',
                args: [poolId as Hex]
            }) as readonly [bigint, number, number, number];

            const sqrtPriceX96 = slot0Data[0];
            
            if (sqrtPriceX96 > 0n) {
                console.log(`[POOL INIT] Pool ${poolId} is already initialized with sqrtPriceX96: ${sqrtPriceX96.toString()}`);
                return res.status(200).json({
                    isInitialized: true,
                    message: `Pool ${token0Symbol}/${token1Symbol} is already initialized`,
                    poolId
                });
            } else {
                console.log(`[POOL INIT] Pool ${poolId} exists but sqrtPriceX96 is 0 - needs initialization`);
                
                // Calculate initial price (1:1 for stablecoins, or market price)
                const initialSqrtPriceX96 = "79228162514264337593543950336"; // sqrt(1) * 2^96 for 1:1 price
                
                return res.status(200).json({
                    isInitialized: false,
                    needsInitialization: true,
                    message: `Pool ${token0Symbol}/${token1Symbol} needs to be initialized. Please use Uniswap V4 PoolManager to initialize with sqrtPriceX96: ${initialSqrtPriceX96}`,
                    poolId
                });
            }
        } catch (error) {
            console.error(`[POOL INIT] Error checking pool ${poolId}:`, error);
            return res.status(200).json({
                isInitialized: false,
                needsInitialization: true,
                message: `Pool ${token0Symbol}/${token1Symbol} may not exist or needs initialization. Error: ${error}`,
                poolId
            });
        }

    } catch (error: any) {
        console.error("[API initialize-pool] Error:", error);
        return res.status(500).json({ 
            message: error.message || "An unknown error occurred.", 
            isInitialized: false 
        });
    }
} 