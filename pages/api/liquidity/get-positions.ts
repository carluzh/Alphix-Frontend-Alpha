import { ethers } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, type Address, type Hex, encodeAbiParameters, keccak256 } from "viem";
import { getTokenSymbolByAddress, getToken as getTokenConfig, CHAIN_ID } from "../../../lib/pools-config";
import { getPositionDetails, getPoolState } from "../../../lib/liquidity-utils";

// Load environment variables - ensure .env is at the root or configure path
// dotenv.config({ path: '.env.local' }); // Removed: Next.js handles .env.local automatically

// Constants
const DEFAULT_CHAIN_ID = CHAIN_ID;
const SUBGRAPH_URL = process.env.SUBGRAPH_URL as string;
if (!SUBGRAPH_URL) {
  throw new Error('SUBGRAPH_URL env var is required');
}

// Minimal subgraph types and query
interface SubgraphPosition {
    id: string;
    tokenId?: string;
    owner: string;
    createdAtTimestamp?: string;
}
const GET_USER_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    positions(first: 200, orderBy: tokenId, orderDirection: desc, where: { owner: $owner }) {
      id
      tokenId
      owner
      createdAtTimestamp
    }
  }
`;
// duplicate removed

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

// duplicate types/query removed

// Helper to parse tokenId from composite subgraph id (last dash component hex)
function parseTokenIdFromCompositeId(compositeId: string): bigint | null {
    try {
        const lastDash = compositeId.lastIndexOf('-');
        if (lastDash === -1) return null;
        const hex = compositeId.slice(lastDash + 1);
        if (!hex.startsWith('0x')) return null;
        return BigInt(hex);
    } catch {
        return null;
    }
}

// Removed tokenURI parsing fallback (subgraph-only discovery now; details are on-chain)

async function fetchAndProcessUserPositionsForApi(ownerAddress: string): Promise<ProcessedPosition[]> {
    // Minimal logging only; no timers/withTimeout
    const owner = getAddress(ownerAddress);
    // Subgraph-only path
    try {
        const resp = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: GET_USER_POSITIONS_QUERY, variables: { owner: owner.toLowerCase() } }),
        });
        if (resp.ok) {
            const json = await resp.json() as { data?: { positions: SubgraphPosition[] } };
            const raw = json?.data?.positions ?? [];
            // (debug logging removed)
            // Also return processed results using live slot0 for balances
            if (raw.length > 0) {
                const processed: ProcessedPosition[] = [];
                const stateCache = new Map<string, { sqrtPriceX96: string; tick: number; poolLiquidity: string }>();
                for (const r of raw) {
                    try {
                        const tokenId = parseTokenIdFromCompositeId(r.id) ?? (r.tokenId ? BigInt(r.tokenId) : null);
                        if (tokenId === null) continue;
                        // (debug logging removed)
                        // On-chain position details (poolKey, ticks, liquidity)
                        const details = await getPositionDetails(tokenId);
                        // Compute poolId bytes32 locally from poolKey (subgraph schema doesn't expose pool)
                        const encodedPoolKey = encodeAbiParameters([
                            { type: 'tuple', components: [
                                { name: 'currency0', type: 'address' },
                                { name: 'currency1', type: 'address' },
                                { name: 'fee', type: 'uint24' },
                                { name: 'tickSpacing', type: 'int24' },
                                { name: 'hooks', type: 'address' },
                            ]}
                        ], [{
                            currency0: details.poolKey.currency0 as `0x${string}`,
                            currency1: details.poolKey.currency1 as `0x${string}`,
                            fee: Number(details.poolKey.fee),
                            tickSpacing: Number(details.poolKey.tickSpacing),
                            hooks: details.poolKey.hooks as `0x${string}`,
                        }]);
                        const poolIdHex = keccak256(encodedPoolKey) as Hex;
                        const poolIdStr = poolIdHex;
                        let state = stateCache.get(poolIdStr);
                        if (!state) {
                            const ps = await getPoolState(poolIdHex);
                            state = { sqrtPriceX96: ps.sqrtPriceX96.toString(), tick: Number(ps.tick), poolLiquidity: ps.liquidity.toString() };
                            stateCache.set(poolIdStr, state);
                        }
                        // Token metadata
                        const t0Addr = details.poolKey.currency0 as Address;
                        const t1Addr = details.poolKey.currency1 as Address;
                        const sym0 = getTokenSymbolByAddress(t0Addr) || 'T0';
                        const sym1 = getTokenSymbolByAddress(t1Addr) || 'T1';
                        const cfg0 = sym0 ? getTokenConfig(sym0) : undefined;
                        const cfg1 = sym1 ? getTokenConfig(sym1) : undefined;
                        const dec0 = cfg0?.decimals ?? 18;
                        const dec1 = cfg1?.decimals ?? 18;
                        const t0 = new Token(DEFAULT_CHAIN_ID, t0Addr, dec0, sym0);
                        const t1 = new Token(DEFAULT_CHAIN_ID, t1Addr, dec1, sym1);
                        // Build pool and position from on-chain data
                        const v4Pool = new V4Pool(
                            t0,
                            t1,
                            details.poolKey.fee,
                            details.poolKey.tickSpacing,
                            details.poolKey.hooks,
                            state.sqrtPriceX96,
                            JSBI.BigInt(state.poolLiquidity),
                            state.tick
                        );
                        const v4Position = new V4Position({
                            pool: v4Pool,
                            tickLower: details.tickLower,
                            tickUpper: details.tickUpper,
                            liquidity: JSBI.BigInt(details.liquidity.toString()),
                        });
                        const raw0 = v4Position.amount0.quotient.toString();
                        const raw1 = v4Position.amount1.quotient.toString();
                        processed.push({
                            positionId: r.id || '',
                            poolId: poolIdStr,
                            token0: { address: t0.address, symbol: t0.symbol || 'T0', amount: ethers.utils.formatUnits(raw0, t0.decimals), rawAmount: raw0 },
                            token1: { address: t1.address, symbol: t1.symbol || 'T1', amount: ethers.utils.formatUnits(raw1, t1.decimals), rawAmount: raw1 },
                            tickLower: details.tickLower,
                            tickUpper: details.tickUpper,
                            liquidityRaw: details.liquidity.toString(),
                            ageSeconds: Math.max(0, Math.floor(Date.now()/1000) - Number(r.createdAtTimestamp || 0)),
                            blockTimestamp: String(r.createdAtTimestamp || '0'),
                            isInRange: state.tick >= details.tickLower && state.tick < details.tickUpper,
                        });
                    } catch (e: any) {
                        try { console.error('get-positions: failed for id', r?.id, 'error:', e?.message || e); } catch {}
                    }
                }
                // (debug logging removed)
                return processed;
            }
        }
    } catch {}
    // If the subgraph returns nothing or fails, return empty list (no on-chain fallback)
    return [];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessedPosition[] | { message: string; count?: number; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { ownerAddress, countOnly, idsOnly, withCreatedAt } = req.query as { ownerAddress?: string; countOnly?: string; idsOnly?: string; withCreatedAt?: string };

  if (!ownerAddress || typeof ownerAddress !== 'string' || !ethers.utils.isAddress(ownerAddress)) { // Keep ethers for isAddress for now, or switch to viem's isAddress
    return res.status(400).json({ message: 'Valid ownerAddress query parameter is required.' });
  }

  try {
    if (countOnly === '1') {
      // Count via subgraph only
      try {
        const resp = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_USER_POSITIONS_QUERY, variables: { owner: ownerAddress.toLowerCase() } }),
        });
        if (!resp.ok) return res.status(200).json({ message: 'ok', count: 0 });
        const json = await resp.json() as { data?: { positions: SubgraphPosition[] } };
        const raw = json?.data?.positions ?? [];
        return res.status(200).json({ message: 'ok', count: raw.length });
      } catch {
        return res.status(200).json({ message: 'ok', count: 0 });
      }
    }

    if (idsOnly === '1') {
      // Return only tokenIds (no on-chain processing)
      try {
        const resp = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_USER_POSITIONS_QUERY, variables: { owner: ownerAddress.toLowerCase() } }),
        });
        if (!resp.ok) return res.status(200).json([] as any);
        const json = await resp.json() as { data?: { positions: SubgraphPosition[] } };
        const raw = json?.data?.positions ?? [];
        if (withCreatedAt === '1') {
          const list = raw.map(r => {
            const parsed = r.tokenId ? BigInt(r.tokenId) : parseTokenIdFromCompositeId(r.id);
            const idStr = parsed ? parsed.toString() : '';
            return idStr ? { id: idStr, createdAt: Number(r.createdAtTimestamp || 0) } : null;
          }).filter(Boolean) as Array<{ id: string; createdAt: number }>;
          return res.status(200).json(list as any);
        } else {
          const ids = Array.from(new Set(raw.map(r => {
            if (r.tokenId) return String(r.tokenId);
            const parsed = parseTokenIdFromCompositeId(r.id);
            return parsed ? parsed.toString() : '';
          }).filter(Boolean)));
          return res.status(200).json(ids as any);
        }
      } catch {
        return res.status(200).json([] as any);
      }
    }

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