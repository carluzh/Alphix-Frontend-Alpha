import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, parseAbi, type Hex } from "viem";
import { publicClient } from "../../../lib/viemClient";

const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4");

interface GetPoolParamsRequest extends NextApiRequest {
    query: {
        poolId: string;
    };
}

interface GetPoolParamsResponse {
    poolId: string;
    sqrtPriceX96: string;
    tick: number;
    protocolFee: number;
    lpFee: number;
    isInitialized: boolean;
    message: string;
}

export default async function handler(
    req: GetPoolParamsRequest,
    res: NextApiResponse<GetPoolParamsResponse>
) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ 
            message: `Method ${req.method} Not Allowed`,
            poolId: '',
            sqrtPriceX96: '0',
            tick: 0,
            protocolFee: 0,
            lpFee: 0,
            isInitialized: false
        });
    }

    try {
        const { poolId } = req.query;

        if (!poolId || typeof poolId !== 'string') {
            return res.status(400).json({ 
                message: "Pool ID is required",
                poolId: '',
                sqrtPriceX96: '0',
                tick: 0,
                protocolFee: 0,
                lpFee: 0,
                isInitialized: false
            });
        }

        console.log(`[POOL PARAMS] Querying parameters for pool: ${poolId}`);

        // Query pool slot0 data to get current state
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

            const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0Data;
            
            const isInitialized = sqrtPriceX96 > 0n;
            
            console.log(`[POOL PARAMS] Pool ${poolId} parameters:`);
            console.log(`[POOL PARAMS] - sqrtPriceX96: ${sqrtPriceX96.toString()}`);
            console.log(`[POOL PARAMS] - tick: ${tick}`);
            console.log(`[POOL PARAMS] - protocolFee: ${protocolFee}`);
            console.log(`[POOL PARAMS] - lpFee: ${lpFee}`);
            console.log(`[POOL PARAMS] - isInitialized: ${isInitialized}`);

            // Note: Tick spacing is not directly available from slot0
            // It's encoded in the pool key when the pool was created
            // Common V4 tick spacings: 1, 10, 60, 200
            
            let inferredTickSpacing = "unknown";
            if (tick % 200 === 0) inferredTickSpacing = "200 (likely)";
            else if (tick % 60 === 0) inferredTickSpacing = "60 (likely)";
            else if (tick % 10 === 0) inferredTickSpacing = "10 (likely)";
            else if (tick % 1 === 0) inferredTickSpacing = "1 (likely)";

            const message = isInitialized 
                ? `Pool is initialized. Inferred tick spacing: ${inferredTickSpacing}`
                : `Pool exists but is not initialized (sqrtPriceX96 = 0)`;

            return res.status(200).json({
                poolId,
                sqrtPriceX96: sqrtPriceX96.toString(),
                tick,
                protocolFee,
                lpFee,
                isInitialized,
                message
            });

        } catch (error) {
            console.error(`[POOL PARAMS] Error querying pool ${poolId}:`, error);
            return res.status(500).json({
                message: `Error querying pool: ${error}`,
                poolId,
                sqrtPriceX96: '0',
                tick: 0,
                protocolFee: 0,
                lpFee: 0,
                isInitialized: false
            });
        }

    } catch (error: any) {
        console.error("[API get-pool-params] Error:", error);
        return res.status(500).json({ 
            message: error.message || "An unknown error occurred.",
            poolId: '',
            sqrtPriceX96: '0',
            tick: 0,
            protocolFee: 0,
            lpFee: 0,
            isInitialized: false
        });
    }
} 