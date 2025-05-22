import { ethers } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
// import dotenv from "dotenv"; // Removed
import type { NextApiRequest, NextApiResponse } from 'next';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi"; // Adjusted path
import { publicClient } from "../../../lib/viemClient"; // Import publicClient
import { getAddress, parseAbi, type Address, type Abi } from "viem"; // Import getAddress and parseAbi, and added Abi for type cast

// Load environment variables - ensure .env is at the root or configure path
// dotenv.config({ path: '.env.local' }); // Removed: Next.js handles .env.local automatically

// Constants
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest";
// const RPC_URL = process.env.RPC_URL; // No longer directly used here
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4"); // Use getAddress for checksum
const DEFAULT_FEE = 8388608;
const DEFAULT_TICK_SPACING = 60;
const DEFAULT_HOOK_ADDRESS = "0x94ba380a340E020Dc29D7883f01628caBC975000";
const DEFAULT_CHAIN_ID = 84532; // Base Sepolia

// --- Interfaces for Subgraph Response ---
interface SubgraphToken {
    id: string;
    symbol: string;
    decimals: string;
}

interface SubgraphHookPosition {
    id: string;
    pool: string;
    owner: string;
    hook: string;
    currency0: SubgraphToken;
    currency1: SubgraphToken;
    tickLower: string;
    tickUpper: string;
    liquidity: string;
    blockNumber: string;
    blockTimestamp: string;
}

interface SubgraphResponse {
    data?: { // Make data optional to handle potential subgraph errors better
        hookPositions: SubgraphHookPosition[];
    };
    errors?: any[]; // To capture subgraph errors
}

// --- Interface for Processed Position Data ---
interface ProcessedPositionToken {
    address: string;
    symbol: string;
    amount: string;
    rawAmount: string;
}

export interface ProcessedPosition { // Export for frontend type usage
    positionId: string;
    poolId: string;
    token0: ProcessedPositionToken;
    token1: ProcessedPositionToken;
    tickLower: number;
    tickUpper: number;
    liquidityRaw: string;
    ageSeconds: number;
    blockTimestamp: string;
    isInRange: boolean;
}

const GET_USER_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    hookPositions(first: 100, orderBy: liquidity, orderDirection: desc, where: { owner: $owner }) {
      id
      pool
      owner
      hook
      currency0 {
        id
        symbol
        decimals
      }
      currency1 {
        id
        symbol
        decimals
      }
      tickLower
      tickUpper
      liquidity
      blockNumber
      blockTimestamp
    }
  }
`;

async function fetchAndProcessUserPositionsForApi(ownerAddress: string): Promise<ProcessedPosition[]> {
    // Removed the explicit RPC_URL check here, as publicClient handles its own RPC configuration, including defaults.
    // if (!process.env.RPC_URL && !process.env.NEXT_PUBLIC_RPC_URL) { 
    //     console.error("Missing environment variable: RPC_URL or NEXT_PUBLIC_RPC_URL for get-positions API (used by publicClient)");
    //     throw new Error("Server configuration error: RPC_URL is not set for publicClient.");
    // }

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    console.log(`API: Fetching positions for owner: ${ownerAddress}`);

    const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: GET_USER_POSITIONS_QUERY,
            variables: { owner: ownerAddress.toLowerCase() },
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`API: Subgraph query failed with status ${response.status}: ${errorBody}`);
        throw new Error(`Subgraph query failed: ${errorBody}`);
    }

    const result = (await response.json()) as SubgraphResponse;

    if (result.errors) {
        console.error("API: Subgraph returned errors:", result.errors);
        throw new Error(`Subgraph error(s): ${JSON.stringify(result.errors)}`);
    }
    
    if (!result.data || !result.data.hookPositions) {
        console.warn("API: Subgraph response is missing data.hookPositions field or it's null.", result);
        return []; // No positions found or error in query structure
    }
    const rawPositions = result.data.hookPositions;

    if (rawPositions.length === 0) {
        console.log("API: No positions found for this owner.");
        return [];
    }

    console.log(`API: Found ${rawPositions.length} raw positions. Processing...`);

    const processedPositions: ProcessedPosition[] = [];
    const poolStatesCache = new Map<string, { sqrtPriceX96: string; tick: number }>();

    for (const rawPos of rawPositions) {
        try {
            const poolId = rawPos.pool;
            const token0Data = rawPos.currency0;
            const token1Data = rawPos.currency1;

            if (!poolId) {
                console.error(`API: Error processing position ID ${rawPos.id}: 'pool' ID string is missing. Skipping.`, rawPos);
                continue;
            }
            if (!token0Data || typeof token0Data.decimals === 'undefined' || typeof token0Data.symbol === 'undefined' || typeof token0Data.id === 'undefined') {
                console.error(`API: Error processing position ID ${rawPos.id}: currency0 or its fields (id, symbol, decimals) are missing. Skipping. Currency0 data:`, token0Data);
                continue; 
            }
            if (!token1Data || typeof token1Data.decimals === 'undefined' || typeof token1Data.symbol === 'undefined' || typeof token1Data.id === 'undefined') {
                console.error(`API: Error processing position ID ${rawPos.id}: currency1 or its fields (id, symbol, decimals) are missing. Skipping. Currency1 data:`, token1Data);
                continue;
            }

            const token0Decimals = parseInt(token0Data.decimals, 10);
            const token1Decimals = parseInt(token1Data.decimals, 10);
            
            const sdkToken0 = new Token(DEFAULT_CHAIN_ID, token0Data.id, token0Decimals, token0Data.symbol);
            const sdkToken1 = new Token(DEFAULT_CHAIN_ID, token1Data.id, token1Decimals, token1Data.symbol);

            let slot0;
            if (poolStatesCache.has(poolId)) {
                slot0 = poolStatesCache.get(poolId)!;
            } else {
                try {
                    // const slot0Data = await stateViewContract.getSlot0(poolId); // Old ethers call
                    const slot0Data = await publicClient.readContract({
                        address: STATE_VIEW_ADDRESS,
                        abi: stateViewAbiViem,
                        functionName: 'getSlot0',
                        args: [poolId as `0x${string}`] // poolId should be bytes32, ensure it's correctly formatted hex
                    }) as readonly [bigint, number, number, number]; // Explicit type assertion for the result
                    // Viem returns an array/tuple for multiple return values or an object if named
                    // Based on ABI: "returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"
                    // It will be an array: [sqrtPriceX96, tick, protocolFee, lpFee]
                    slot0 = {
                        sqrtPriceX96: slot0Data[0].toString(),
                        tick: Number(slot0Data[1]),
                        // protocolFee: Number(slot0Data[2]), // if needed
                        // lpFee: Number(slot0Data[3]), // if needed
                    };
                    poolStatesCache.set(poolId, slot0);
                } catch (err) {
                    console.error(`API: Error fetching slot0 for pool ${poolId}:`, err);
                    continue; 
                }
            }

            const v4Pool = new V4Pool(
                sdkToken0,
                sdkToken1,
                DEFAULT_FEE, // Assuming fee is constant from PoolKey, might need to fetch if dynamic
                DEFAULT_TICK_SPACING, // Assuming tickSpacing is constant
                rawPos.hook || DEFAULT_HOOK_ADDRESS, // Use hook from position or default
                slot0.sqrtPriceX96,
                JSBI.BigInt(0), // Liquidity (not strictly needed for position.amount0/1 calc from existing liquidity)
                slot0.tick
            );

            const v4Position = new V4Position({
                pool: v4Pool,
                tickLower: Number(rawPos.tickLower),
                tickUpper: Number(rawPos.tickUpper),
                liquidity: JSBI.BigInt(rawPos.liquidity)
            });

            const rawAmount0 = v4Position.amount0.quotient.toString();
            const rawAmount1 = v4Position.amount1.quotient.toString();
            
            const formattedAmount0 = ethers.utils.formatUnits(rawAmount0, sdkToken0.decimals);
            const formattedAmount1 = ethers.utils.formatUnits(rawAmount1, sdkToken1.decimals);

            const ageSeconds = Math.floor(Date.now() / 1000) - Number(rawPos.blockTimestamp);
            const isInRange = slot0.tick >= Number(rawPos.tickLower) && slot0.tick < Number(rawPos.tickUpper);

            processedPositions.push({
                positionId: rawPos.id,
                poolId: poolId,
                token0: {
                    address: sdkToken0.address,
                    symbol: sdkToken0.symbol || 'N/A',
                    amount: formattedAmount0,
                    rawAmount: rawAmount0,
                },
                token1: {
                    address: sdkToken1.address,
                    symbol: sdkToken1.symbol || 'N/A',
                    amount: formattedAmount1,
                    rawAmount: rawAmount1,
                },
                tickLower: Number(rawPos.tickLower),
                tickUpper: Number(rawPos.tickUpper),
                liquidityRaw: rawPos.liquidity,
                ageSeconds,
                blockTimestamp: rawPos.blockTimestamp,
                isInRange,
            });
        } catch (error) {
            console.error(`API: Error processing position ID ${rawPos.id} (outer try-catch):`, error);
        }
    }

    console.log(`API: Successfully processed ${processedPositions.length} of ${rawPositions.length} positions.`);
    return processedPositions;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessedPosition[] | { message: string; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { ownerAddress } = req.query;

  if (!ownerAddress || typeof ownerAddress !== 'string' || !ethers.utils.isAddress(ownerAddress)) { // Keep ethers for isAddress for now, or switch to viem's isAddress
    return res.status(400).json({ message: 'Valid ownerAddress query parameter is required.' });
  }

  try {
    const positions = await fetchAndProcessUserPositionsForApi(ownerAddress);
    return res.status(200).json(positions);
  } catch (error: any) {
    console.error(`API Error in /api/liquidity/get-positions for ${ownerAddress}:`, error);
    // Ensure error is serializable
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching positions.";
    const errorDetails = error instanceof Error ? { name: error.name, stack: error.stack } : {}; // Include more details if needed, carefully for prod
    // Check if running in development to provide more details
    const detailedError = process.env.NODE_ENV === 'development' ? errorDetails : {};
    return res.status(500).json({ message: errorMessage, error: detailedError });
  }
} 