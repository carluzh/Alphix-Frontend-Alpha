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
    id: string; // bytes32 salt (tokenId)
    owner: string;
    tickLower: string;
    tickUpper: string;
    liquidity: string;
    creationTimestamp: string;
    lastTimestamp: string;
    pool: { id: string };
}
const GET_USER_HOOK_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    hookPositions(first: 200, orderBy: id, orderDirection: desc, where: { owner: $owner }) {
      id
      owner
      tickLower
      tickUpper
      liquidity
      creationTimestamp
      lastTimestamp
      pool { id }
    }
  }
`;

const GET_USER_LEGACY_POSITIONS_QUERY = `
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
    owner: string;
    poolId: string;
    token0: ProcessedPositionToken;
    token1: ProcessedPositionToken;
    tickLower: number;
    tickUpper: number;
    liquidityRaw: string;
    ageSeconds: number;
    blockTimestamp: number;
    lastTimestamp: number; // Last modification timestamp (for APY calculation)
    isInRange: boolean;
    // Optimistic UI state flags (added by invalidation.ts)
    isPending?: boolean; // Position is being minted (show skeleton)
    isRemoving?: boolean; // Position is being burned (fade out)
    isOptimisticallyUpdating?: boolean; // Position has optimistic updates (show loading indicator)
}

// duplicate types/query removed

// Helper to parse tokenId from composite subgraph id (last dash component hex)
function parseTokenIdFromHexId(idHex: string): bigint | null {
    try {
        if (!idHex || !idHex.startsWith('0x')) return null;
        return BigInt(idHex);
    } catch { return null; }
}

// Removed tokenURI parsing fallback (subgraph-only discovery now; details are on-chain)

async function fetchAndProcessUserPositionsForApi(ownerAddress: string): Promise<ProcessedPosition[]> {
    // Minimal logging only; no timers/withTimeout
    const owner = getAddress(ownerAddress);

    // Query both subgraphs in parallel (default and DAI)
    const SUBGRAPH_URL_DAI = process.env.SUBGRAPH_URL_DAI;
    const subgraphUrls = [SUBGRAPH_URL];
    if (SUBGRAPH_URL_DAI && SUBGRAPH_URL_DAI !== SUBGRAPH_URL) {
        subgraphUrls.push(SUBGRAPH_URL_DAI);
    }

    // Fetch from all subgraphs
    let allRawPositions: SubgraphPosition[] = [];
    const seenPositionIds = new Set<string>(); // Track position IDs to prevent duplicates

    for (const subgraphUrl of subgraphUrls) {
        try {
            const resp = await fetch(subgraphUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: GET_USER_HOOK_POSITIONS_QUERY, variables: { owner: owner.toLowerCase() } }),
            });
            if (resp.ok) {
                const json = await resp.json() as { data?: { positions: SubgraphPosition[] } };
                let raw = (json as any)?.data?.hookPositions ?? [] as SubgraphPosition[];

                // Fallback to legacy positions if hookPositions empty
                if (!Array.isArray(raw) || raw.length === 0) {
                    try {
                        const respLegacy = await fetch(subgraphUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ query: GET_USER_LEGACY_POSITIONS_QUERY, variables: { owner: owner.toLowerCase() } }),
                        });
                        if (respLegacy.ok) {
                            const jsonLegacy = await respLegacy.json() as any;
                            const legacy = (jsonLegacy?.data?.positions || []) as Array<{ id: string; tokenId?: string; owner: string; createdAtTimestamp?: string }>;
                            raw = legacy.map((p) => ({
                                id: p.id,
                                owner: p.owner,
                                tickLower: '0',
                                tickUpper: '0',
                                liquidity: '0',
                                creationTimestamp: p.createdAtTimestamp || '0',
                                lastTimestamp: undefined as any,
                                pool: { id: '' },
                            }));
                        }
                    } catch {}
                }

                // Deduplicate positions across subgraphs
                for (const pos of raw) {
                    if (!seenPositionIds.has(pos.id)) {
                        seenPositionIds.add(pos.id);
                        allRawPositions.push(pos);
                    }
                }
            }
        } catch (err) {
            console.error('[get-positions] Error fetching from subgraph', subgraphUrl, err);
        }
    }

    // Process all positions
    try {
        if (allRawPositions.length > 0) {
                // Step 1: Batch fetch all position details in parallel
                const positionDetailPromises = allRawPositions.map(async (r) => {
                    try {
                        const tokenId = parseTokenIdFromHexId(r.id);
                        if (tokenId === null) return null;
                        const details = await getPositionDetails(tokenId);
                        return { r, tokenId, details };
                    } catch (e: any) {
                        console.error('get-positions: failed to fetch details for id', r?.id, 'error:', e?.message || e);
                        return null;
                    }
                });

                const positionsWithDetails = (await Promise.all(positionDetailPromises)).filter(Boolean) as Array<{
                    r: SubgraphPosition;
                    tokenId: bigint;
                    details: Awaited<ReturnType<typeof getPositionDetails>>;
                }>;

                // Step 2: Determine unique pool IDs and batch fetch pool states
                const poolIdMap = new Map<string, Hex>();
                for (const { r, details } of positionsWithDetails) {
                    let poolIdHex = (r.pool?.id || '') as Hex;
                    if (!poolIdHex || !poolIdHex.startsWith('0x')) {
                        // Legacy path: compute poolId from poolKey
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
                        poolIdHex = keccak256(encodedPoolKey) as Hex;
                    }
                    poolIdMap.set(poolIdHex, poolIdHex);
                }

                // Batch fetch all unique pool states in parallel
                const uniquePoolIds = Array.from(poolIdMap.values());
                const poolStatePromises = uniquePoolIds.map(async (poolId) => {
                    try {
                        const state = await getPoolState(poolId);
                        return { poolId, state };
                    } catch (e: any) {
                        console.error('get-positions: failed to fetch pool state for', poolId, 'error:', e?.message || e);
                        return null;
                    }
                });

                const poolStates = (await Promise.all(poolStatePromises)).filter(Boolean) as Array<{
                    poolId: Hex;
                    state: { sqrtPriceX96: bigint; tick: number; liquidity: bigint };
                }>;

                const stateCache = new Map<string, { sqrtPriceX96: string; tick: number; poolLiquidity: string }>();
                for (const { poolId, state } of poolStates) {
                    stateCache.set(poolId, {
                        sqrtPriceX96: state.sqrtPriceX96.toString(),
                        tick: Number(state.tick),
                        poolLiquidity: state.liquidity.toString(),
                    });
                }

                // Step 3: Process positions with fetched data
                const processed: ProcessedPosition[] = [];
                for (const { r, details } of positionsWithDetails) {
                    try {
                        // Determine poolId (same logic as before)
                        let poolIdHex = (r.pool?.id || '') as Hex;
                        if (!poolIdHex || !poolIdHex.startsWith('0x')) {
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
                            poolIdHex = keccak256(encodedPoolKey) as Hex;
                        }
                        const poolIdStr = poolIdHex;
                        const state = stateCache.get(poolIdStr);
                        if (!state) {
                            console.warn('get-positions: no pool state found for', poolIdStr, '- skipping position');
                            continue;
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
                        const createdTs = Number(r.creationTimestamp || (r as any).createdAtTimestamp || 0);
                        const lastTs = Number(r.lastTimestamp || 0);

                        processed.push({
                            positionId: r.id || '',
                            owner: r.owner,
                            poolId: poolIdStr,
                            token0: { address: t0.address, symbol: t0.symbol || 'T0', amount: ethers.utils.formatUnits(raw0, t0.decimals), rawAmount: raw0 },
                            token1: { address: t1.address, symbol: t1.symbol || 'T1', amount: ethers.utils.formatUnits(raw1, t1.decimals), rawAmount: raw1 },
                            tickLower: Number((r as any).tickLower ?? details.tickLower),
                            tickUpper: Number((r as any).tickUpper ?? details.tickUpper),
                            liquidityRaw: ((r as any).liquidity ?? details.liquidity.toString()).toString(),
                            ageSeconds: Math.max(0, Math.floor(Date.now()/1000) - createdTs),
                            blockTimestamp: createdTs || 0,
                            lastTimestamp: lastTs || createdTs || 0,
                            isInRange: state.tick >= details.tickLower && state.tick < details.tickUpper,
                        });
                    } catch (e: any) {
                        console.error('get-positions: failed to process position id', r?.id, 'error:', e?.message || e);
                    }
                }
                return processed;
            }
    } catch {}
    // If the subgraph returns nothing or fails, return empty list (no on-chain fallback)
    return [];
}

// Simple in-memory server cache to hold the last successful positions payload for an owner
const serverCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessedPosition[] | { message: string; count?: number; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { ownerAddress, countOnly, idsOnly, withCreatedAt } = req.query as { ownerAddress?: string; countOnly?: string; idsOnly?: string; withCreatedAt?: string };

  if (!ownerAddress || typeof ownerAddress !== 'string' || !ethers.utils.isAddress(ownerAddress)) {
    return res.status(400).json({ message: 'Valid ownerAddress query parameter is required.' });
  }

  const cacheKey = `positions:${ownerAddress.toLowerCase()}`;

  try {
    if (countOnly === '1' || idsOnly === '1') {
      // For lightweight modes, bypass the main cache and fetch directly.
      // These are less critical and have their own internal fallbacks.
      const resp = await fetchIdsOrCount(ownerAddress, idsOnly === '1', withCreatedAt === '1');
      return res.status(200).json(resp as any);
    }

    const positions = await fetchAndProcessUserPositionsForApi(ownerAddress);
    // On success, update the cache.
    serverCache.set(cacheKey, { data: positions, ts: Date.now() });
    return res.status(200).json(positions);
  } catch (error: any) {
    console.error(`API Error in /api/liquidity/get-positions for ${ownerAddress}:`, error);
    
    // On failure, attempt to serve from cache
    const cached = serverCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS * 10) { // Allow stale for up to 20 mins
      console.warn(`[get-positions] Serving stale positions for ${ownerAddress} due to fetch error.`);
      res.setHeader('Cache-Control', 'no-store'); // Do not cache the stale response
      return res.status(200).json(cached.data);
    }
    
    // If fetch fails and cache is empty or too old, return an error
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching positions.";
    return res.status(500).json({ message: errorMessage });
  }
}

// Extracted helper for idsOnly/countOnly to keep main handler clean
async function fetchIdsOrCount(ownerAddress: string, idsOnly: boolean, withCreatedAt: boolean) {
  // Query both subgraphs in parallel (default and DAI)
  const SUBGRAPH_URL_DAI = process.env.SUBGRAPH_URL_DAI;
  const subgraphUrls = [SUBGRAPH_URL];
  if (SUBGRAPH_URL_DAI && SUBGRAPH_URL_DAI !== SUBGRAPH_URL) {
    subgraphUrls.push(SUBGRAPH_URL_DAI);
  }

  let allRawPositions: SubgraphPosition[] = [];
  const seenPositionIds = new Set<string>(); // Track position IDs to prevent duplicates

  for (const subgraphUrl of subgraphUrls) {
    try {
      const resp = await fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: GET_USER_HOOK_POSITIONS_QUERY, variables: { owner: ownerAddress.toLowerCase() } }),
      });
      if (!resp.ok) continue;
      const json = await resp.json() as any;
      let raw = (json?.data?.hookPositions || []) as SubgraphPosition[];
      if ((!Array.isArray(raw) || raw.length === 0)) {
        try {
          const respLegacy = await fetch(subgraphUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: GET_USER_LEGACY_POSITIONS_QUERY, variables: { owner: ownerAddress.toLowerCase() } }),
          });
          if (respLegacy.ok) {
            const jsonLegacy = await respLegacy.json() as any;
            const legacy = (jsonLegacy?.data?.positions || []) as Array<{ id: string; tokenId?: string; owner: string; createdAtTimestamp?: string }>;
            raw = legacy.map((p) => ({
              id: p.id,
              owner: p.owner,
              tickLower: '0',
              tickUpper: '0',
              liquidity: '0',
              creationTimestamp: p.createdAtTimestamp || '0',
              lastTimestamp: '0',
              pool: { id: '' },
            })) as any;
          }
        } catch {}
      }
      // Deduplicate positions across subgraphs
      for (const pos of raw) {
        if (!seenPositionIds.has(pos.id)) {
          seenPositionIds.add(pos.id);
          allRawPositions.push(pos);
        }
      }
    } catch (err) {
      console.error('[get-positions] Error in fetchIdsOrCount from', subgraphUrl, err);
    }
  }

  try {
    const raw = allRawPositions;

    if (!idsOnly) {
        return { message: 'ok', count: raw.length };
    }
    
    if (withCreatedAt) {
      const list = raw.map(r => {
        const parsed = parseTokenIdFromHexId(r.id);
        const idStr = parsed ? parsed.toString() : '';
        return idStr ? { id: idStr, createdAt: Number(r.creationTimestamp || 0), lastTimestamp: Number(r.lastTimestamp || 0) } : null;
      }).filter(Boolean) as Array<{ id: string; createdAt: number; lastTimestamp?: number }>;
      return list;
    } else {
      const ids = Array.from(new Set(raw.map(r => {
        const parsed = parseTokenIdFromHexId(r.id);
        return parsed ? parsed.toString() : '';
      }).filter(Boolean)));
      return ids;
    }
  } catch {
    return idsOnly ? [] : { message: 'ok', count: 0 };
  }
} 