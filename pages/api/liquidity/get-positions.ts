import { ethers } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
// import dotenv from "dotenv"; // Removed
import type { NextApiRequest, NextApiResponse } from 'next';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi"; // Adjusted path
import { publicClient } from "../../../lib/viemClient"; // Import publicClient
import { getAddress, parseAbi, type Address, type Abi } from "viem"; // Import getAddress and parseAbi, and added Abi for type cast
import { getTokenSymbolByAddress, getAllPools, getStateViewAddress, CHAIN_ID } from "../../../lib/pools-config"; // Import the mapping utility

// Load environment variables - ensure .env is at the root or configure path
// dotenv.config({ path: '.env.local' }); // Removed: Next.js handles .env.local automatically

// Constants
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";
// const RPC_URL = process.env.RPC_URL; // No longer directly used here
const STATE_VIEW_ADDRESS = getStateViewAddress();
const DEFAULT_CHAIN_ID = CHAIN_ID;

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

// Create pool mapping from pools.json for dynamic lookup
function createPoolTickSpacingMap(): { [poolId: string]: number } {
    const pools = getAllPools();
    const mapping: { [poolId: string]: number } = {};
    
    pools.forEach(pool => {
        if (pool.subgraphId) {
            mapping[pool.subgraphId.toLowerCase()] = pool.tickSpacing;
        }
    });
    
    console.log("Created pool tick spacing mapping:", mapping);
    return mapping;
}

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
    
    // Get pool tick spacing mapping from pools.json
    const poolTickSpacingMap = createPoolTickSpacingMap();

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

            // Get the correct tick spacing for this pool
            let v4PoolTickSpacing = poolTickSpacingMap[poolId.toLowerCase()];
            
            // Find the pool configuration to get fee and hooks
            const pools = getAllPools();
            const poolConfig = pools.find(p => p.subgraphId?.toLowerCase() === poolId.toLowerCase());
            
            if (!poolConfig) {
                console.warn(`API: No pool configuration found for pool ${poolId}, skipping position ${rawPos.id}`);
                continue;
            }
            
            if (!v4PoolTickSpacing) {
                console.warn(`API: No tick spacing found for pool ${poolId}, skipping position ${rawPos.id}`);
                continue;
            }

            const v4Pool = new V4Pool(
                sdkToken0,
                sdkToken1,
                poolConfig.fee, // Use fee from pool configuration
                v4PoolTickSpacing, // Use the correct tick spacing for this pool
                rawPos.hook || poolConfig.hooks, // Use hook from position or pool config
                slot0.sqrtPriceX96,
                JSBI.BigInt(0), // Liquidity (not strictly needed for position.amount0/1 calc from existing liquidity)
                slot0.tick
            );

            // Validate tick values before creating V4Position
            const tickLower = Number(rawPos.tickLower);
            const tickUpper = Number(rawPos.tickUpper);
            
            console.log(`API: Processing position ${rawPos.id} with tickLower=${tickLower}, tickUpper=${tickUpper}, liquidity=${rawPos.liquidity}`);
            
            // Check for valid tick range
            if (tickLower >= tickUpper) {
                console.warn(`API: Skipping position ${rawPos.id} with invalid tick range: tickLower=${tickLower} >= tickUpper=${tickUpper}`);
                continue;
            }
            
            // Check for extreme tick values (V4 has limits around ±887272)
            const MAX_TICK = 887270; // Slightly below the actual max to be safe
            const MIN_TICK = -887270;
            if (tickLower < MIN_TICK || tickUpper > MAX_TICK) {
                console.warn(`API: Skipping position ${rawPos.id} with ticks outside valid range: tickLower=${tickLower}, tickUpper=${tickUpper}`);
                continue;
            }
            
            // Check for zero liquidity positions (closed positions)
            const liquidityBigInt = JSBI.BigInt(rawPos.liquidity);
            if (JSBI.equal(liquidityBigInt, JSBI.BigInt(0))) {
                console.warn(`API: Skipping position ${rawPos.id} with zero liquidity (closed position)`);
                continue;
            }
            
            // Check tick spacing alignment - this is crucial for V4
            if (tickLower % v4PoolTickSpacing !== 0) {
                console.warn(`API: Skipping position ${rawPos.id} with tickLower ${tickLower} not aligned to tick spacing ${v4PoolTickSpacing}`);
                continue;
            }
            if (tickUpper % v4PoolTickSpacing !== 0) {
                console.warn(`API: Skipping position ${rawPos.id} with tickUpper ${tickUpper} not aligned to tick spacing ${v4PoolTickSpacing}`);
                continue;
            }

            const v4Position = new V4Position({
                pool: v4Pool,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidity: liquidityBigInt
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
                    symbol: getTokenSymbolByAddress(sdkToken0.address) || sdkToken0.symbol || 'N/A',
                    amount: formattedAmount0,
                    rawAmount: rawAmount0,
                },
                token1: {
                    address: sdkToken1.address,
                    symbol: getTokenSymbolByAddress(sdkToken1.address) || sdkToken1.symbol || 'N/A',
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
  res: NextApiResponse<ProcessedPosition[] | { message: string; count?: number; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { ownerAddress, countOnly } = req.query as { ownerAddress?: string; countOnly?: string };

  if (!ownerAddress || typeof ownerAddress !== 'string' || !ethers.utils.isAddress(ownerAddress)) { // Keep ethers for isAddress for now, or switch to viem's isAddress
    return res.status(400).json({ message: 'Valid ownerAddress query parameter is required.' });
  }

  try {
    if (countOnly === '1') {
      // Lightweight count query straight to subgraph without processing pools
      const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query GetUserPositionsCount($owner: Bytes!) { hookPositions(where: { owner: $owner }) { id } }`,
          variables: { owner: ownerAddress.toLowerCase() },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`API: Count subgraph query failed: ${errorBody}`);
        return res.status(200).json({ message: 'ok', count: 0 });
      }
      const json = (await response.json()) as { data?: { hookPositions: { id: string }[] } };
      const count = json?.data?.hookPositions?.length ?? 0;
      return res.status(200).json({ message: 'ok', count });
    } else {
      const positions = await fetchAndProcessUserPositionsForApi(ownerAddress);
      return res.status(200).json(positions);
    }
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