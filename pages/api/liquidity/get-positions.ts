import { ethers } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, type Address, type Hex, encodeAbiParameters, keccak256, parseAbi } from "viem";
import { getTokenSymbolByAddress, getToken as getTokenConfig, getChainId, getNetworkModeFromRequest, getPositionManagerAddress, getStateViewAddress, type NetworkMode } from "../../../lib/pools-config";
import { getPositionDetails, getPoolState, calculateUnclaimedFeesV4 } from "@/lib/liquidity/liquidity-utils";
import { getAlphixSubgraphUrl } from "../../../lib/subgraph-url-helper";
import { STATE_VIEW_ABI } from "../../../lib/abis/state_view_abi";
import { createNetworkClient } from "../../../lib/viemClient";

/**
 * Recursively convert BigInt values to strings for JSON serialization.
 * JSON.stringify cannot handle BigInt natively, so we need this helper.
 */
function serializeBigInts<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString() as unknown as T;
    if (Array.isArray(obj)) return obj.map(serializeBigInts) as unknown as T;
    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = serializeBigInts(value);
        }
        return result as T;
    }
    return obj;
}

// Note: Unified Yield positions are fetched separately via fetchUnifiedYieldPositions
// in the client layer (useOverviewPageData, usePoolPositions) for clean separation

// Minimal subgraph types and query
interface SubgraphPosition {
    id: string; // bytes32 salt (tokenId)
    owner: string;
    tickLower: string;
    tickUpper: string;
    liquidity: string;
    creationTimestamp: string;
    lastTimestamp: string;
    poolId: string; // Both testnet and mainnet now use poolId directly
}

// Both testnet and mainnet now use poolId directly (Goldsky subgraph migration)
const GET_USER_HOOK_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    hookPositions(first: 200, orderBy: id, orderDirection: desc, where: { owner: $owner, liquidity_gt: 0 }) {
      id
      owner
      tickLower
      tickUpper
      liquidity
      creationTimestamp
      lastTimestamp
      poolId
    }
  }
`;

// Helper to get the pool ID from position
function getPoolIdFromPosition(pos: SubgraphPosition): string {
  return pos.poolId || '';
}

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

/**
 * V4ProcessedPosition - Standard V4 positions from PositionManager
 *
 * @see interface/apps/web/src/components/Liquidity/types.ts (BasePositionInfo)
 * @see interface/apps/web/src/components/Liquidity/utils/parseFromRest.ts (parseRestPosition)
 */
export interface V4ProcessedPosition {
    /** Type discriminator for union type */
    type: 'v4';
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

    // Fee fields - mirrors Uniswap's token0UncollectedFees/token1UncollectedFees
    // @see interface/apps/web/src/components/Liquidity/types.ts (lines 48-49)
    // @see interface/apps/web/src/components/Liquidity/utils/parseFromRest.ts (lines 393-394)
    token0UncollectedFees?: string;
    token1UncollectedFees?: string;

    // Optimistic UI state flags (added by invalidation.ts)
    isPending?: boolean; // Position is being minted (show skeleton)
    isRemoving?: boolean; // Position is being burned (fade out)
    isOptimisticallyUpdating?: boolean; // Position has optimistic updates (show loading indicator)

    // Unified Yield metadata (set by positionAdapter for display compatibility)
    isUnifiedYield?: boolean;
    hookAddress?: string;
    shareBalance?: string;
}

/**
 * @deprecated Use V4ProcessedPosition instead
 */
export type ProcessedPosition = V4ProcessedPosition;

/**
 * Position - V4 positions only from this API
 *
 * Note: Unified Yield positions are fetched separately via fetchUnifiedYieldPositions
 * in the client layer for clean architectural separation.
 */
export type Position = V4ProcessedPosition;

/**
 * Type guard for V4 positions
 * @deprecated No longer needed since this API only returns V4 positions
 */
export function isV4Position(position: Position): position is V4ProcessedPosition {
    return position.type === 'v4';
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

async function fetchAndProcessUserPositionsForApi(ownerAddress: string, networkMode: NetworkMode): Promise<Position[]> {
    // Minimal logging only; no timers/withTimeout
    const owner = getAddress(ownerAddress);
    const hookPositionsQuery = GET_USER_HOOK_POSITIONS_QUERY;
    const chainId = getChainId(networkMode);

    // Build list of subgraph URLs to query
    const subgraphUrls: string[] = [];
    const primaryUrl = getAlphixSubgraphUrl(networkMode);
    if (primaryUrl) subgraphUrls.push(primaryUrl);

    // Fetch from all subgraphs in parallel (Promise.allSettled pattern identical to Uniswap getPool.ts)
    const subgraphResults = await Promise.allSettled(subgraphUrls.map(async (subgraphUrl) => {
        // AbortController timeout pattern for subgraph fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for subgraph

        try {
            const resp = await fetch(subgraphUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: hookPositionsQuery, variables: { owner: owner.toLowerCase() } }), signal: controller.signal });
            clearTimeout(timeoutId);
            if (!resp.ok) return [];
            const json = await resp.json() as any;
            let raw = json?.data?.hookPositions ?? [] as SubgraphPosition[];
            // Fallback to legacy positions if hookPositions empty (testnet only)
            if (networkMode === 'testnet' && (!Array.isArray(raw) || raw.length === 0)) {
                try {
                    const legacyController = new AbortController();
                    const legacyTimeoutId = setTimeout(() => legacyController.abort(), 10000);
                    const respLegacy = await fetch(subgraphUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GET_USER_LEGACY_POSITIONS_QUERY, variables: { owner: owner.toLowerCase() } }), signal: legacyController.signal });
                    clearTimeout(legacyTimeoutId);
                    if (respLegacy.ok) {
                        const jsonLegacy = await respLegacy.json() as any;
                        const legacy = (jsonLegacy?.data?.positions || []) as Array<{ id: string; tokenId?: string; owner: string; createdAtTimestamp?: string }>;
                        raw = legacy.map(p => ({ id: p.id, owner: p.owner, tickLower: '0', tickUpper: '0', liquidity: '0', creationTimestamp: p.createdAtTimestamp || '0', lastTimestamp: undefined as any, poolId: '' }));
                    }
                } catch {}
            }
            return raw;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }));

    // Extract fulfilled results and deduplicate (Uniswap pattern)
    let allRawPositions: SubgraphPosition[] = [];
    const seenPositionIds = new Set<string>();
    for (const result of subgraphResults) {
        if (result.status !== 'fulfilled') continue;
        for (const pos of result.value) { if (!seenPositionIds.has(pos.id)) { seenPositionIds.add(pos.id); allRawPositions.push(pos); } }
    }

    // Process all positions
    try {
        if (allRawPositions.length > 0) {
                // Step 1: Batch fetch all position details in parallel
                const positionDetailPromises = allRawPositions.map(async (r) => {
                    try {
                        const tokenId = parseTokenIdFromHexId(r.id);
                        if (tokenId === null) return null;
                        const details = await getPositionDetails(tokenId, chainId);
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
                    let poolIdHex = getPoolIdFromPosition(r) as Hex;
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
                        const state = await getPoolState(poolId, chainId);
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

                // Step 3: Batch fetch uncollected fees for all positions
                // Mirrors Uniswap's pattern where fees come WITH position data
                // @see interface/apps/web/src/components/Liquidity/utils/parseFromRest.ts (lines 372-373, 393-394)
                const feeCache = new Map<string, { token0UncollectedFees: string; token1UncollectedFees: string }>();
                try {
                    const client = createNetworkClient(networkMode);
                    const stateView = getStateViewAddress(networkMode);
                    const pmAddress = getPositionManagerAddress(networkMode);
                    const stateViewAbiParsed = parseAbi(STATE_VIEW_ABI);

                    // Build multicall for fee data: getPositionInfo + getFeeGrowthInside per position
                    const feeCalls: Array<{ address: `0x${string}`; abi: any; functionName: string; args: any[] }> = [];
                    const feeMetadata: Array<{ positionId: string; poolIdBytes32: `0x${string}`; tickLower: number; tickUpper: number; salt: `0x${string}` }> = [];

                    for (const { r, details } of positionsWithDetails) {
                        // Compute poolId
                        let poolIdBytes32 = getPoolIdFromPosition(r) as `0x${string}`;
                        if (!poolIdBytes32 || !poolIdBytes32.startsWith('0x')) {
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
                            poolIdBytes32 = keccak256(encodedPoolKey) as `0x${string}`;
                        }

                        const tokenIdStr = r.id.includes('-') ? r.id.split('-').pop()! : r.id;
                        const salt = `0x${BigInt(tokenIdStr).toString(16).padStart(64, '0')}` as `0x${string}`;

                        feeMetadata.push({
                            positionId: r.id,
                            poolIdBytes32,
                            tickLower: details.tickLower,
                            tickUpper: details.tickUpper,
                            salt,
                        });

                        // getPositionInfo: returns (liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128)
                        feeCalls.push({
                            address: stateView as `0x${string}`,
                            abi: stateViewAbiParsed,
                            functionName: 'getPositionInfo',
                            args: [poolIdBytes32, pmAddress as `0x${string}`, details.tickLower, details.tickUpper, salt],
                        });

                        // getFeeGrowthInside: returns (feeGrowthInside0X128, feeGrowthInside1X128)
                        feeCalls.push({
                            address: stateView as `0x${string}`,
                            abi: stateViewAbiParsed,
                            functionName: 'getFeeGrowthInside',
                            args: [poolIdBytes32, details.tickLower, details.tickUpper],
                        });
                    }

                    if (feeCalls.length > 0) {
                        const feeResults = await client.multicall({ contracts: feeCalls });

                        for (let i = 0; i < feeMetadata.length; i++) {
                            try {
                                const meta = feeMetadata[i];
                                const posInfoResult = feeResults[i * 2];
                                const feeInsideResult = feeResults[i * 2 + 1];

                                if (posInfoResult.status === 'failure' || feeInsideResult.status === 'failure') continue;

                                const posInfo = posInfoResult.result as readonly [bigint, bigint, bigint];
                                const feeInside = feeInsideResult.result as readonly [bigint, bigint];

                                // Calculate unclaimed fees (mirrors get-uncollected-fees.ts)
                                const { token0Fees, token1Fees } = calculateUnclaimedFeesV4(
                                    posInfo[0],      // liquidity
                                    feeInside[0],    // feeGrowthInside0X128 (current)
                                    feeInside[1],    // feeGrowthInside1X128 (current)
                                    posInfo[1],      // feeGrowthInside0LastX128
                                    posInfo[2],      // feeGrowthInside1LastX128
                                );

                                feeCache.set(meta.positionId, {
                                    token0UncollectedFees: token0Fees.toString(),
                                    token1UncollectedFees: token1Fees.toString(),
                                });
                            } catch (e) {
                                // Skip fee calculation for this position on error
                            }
                        }
                    }
                } catch (e: any) {
                    console.error('get-positions: failed to batch fetch fees', e?.message || e);
                    // Continue without fees - they'll be undefined
                }

                // Step 4: Process positions with fetched data (including fees)
                const processed: Position[] = [];
                for (const { r, details } of positionsWithDetails) {
                    try {
                        // Skip positions with zero on-chain liquidity (burned/closed)
                        // The subgraph may have stale data, so we check on-chain liquidity
                        if (details.liquidity <= 0n) {
                            continue;
                        }

                        // Determine poolId (handles both testnet pool.id and mainnet poolId)
                        let poolIdHex = getPoolIdFromPosition(r) as Hex;
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
                        const sym0 = getTokenSymbolByAddress(t0Addr, networkMode) || 'T0';
                        const sym1 = getTokenSymbolByAddress(t1Addr, networkMode) || 'T1';
                        const cfg0 = sym0 ? getTokenConfig(sym0, networkMode) : undefined;
                        const cfg1 = sym1 ? getTokenConfig(sym1, networkMode) : undefined;
                        const dec0 = cfg0?.decimals ?? 18;
                        const dec1 = cfg1?.decimals ?? 18;
                        const t0 = new Token(chainId, t0Addr, dec0, sym0);
                        const t1 = new Token(chainId, t1Addr, dec1, sym1);

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

                        // Get fee data from cache (mirrors Uniswap's parseRestPosition pattern)
                        // @see interface/apps/web/src/components/Liquidity/utils/parseFromRest.ts (lines 393-394)
                        const feeData = feeCache.get(r.id);

                        // Convert hex positionId to decimal for cleaner URLs
                        const positionIdDecimal = r.id && r.id.startsWith('0x')
                            ? BigInt(r.id).toString()
                            : (r.id || '');

                        processed.push({
                            type: 'v4',
                            positionId: positionIdDecimal,
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
                            // Fee fields - matches Uniswap's token0UncollectedFees/token1UncollectedFees
                            token0UncollectedFees: feeData?.token0UncollectedFees,
                            token1UncollectedFees: feeData?.token1UncollectedFees,
                        });
                    } catch (e: any) {
                        console.error('get-positions: failed to process position id', r?.id, 'error:', e?.message || e);
                    }
                }

                return processed;
            }
    } catch {}

    // Return empty list if processing fails
    return [];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Position[] | { message: string; count?: number; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie);

  const { ownerAddress, countOnly, idsOnly, withCreatedAt } = req.query as { ownerAddress?: string; countOnly?: string; idsOnly?: string; withCreatedAt?: string };

  if (!ownerAddress || typeof ownerAddress !== 'string' || !ethers.utils.isAddress(ownerAddress)) {
    return res.status(400).json({ message: 'Valid ownerAddress query parameter is required.' });
  }

  try {
    // For lightweight modes (countOnly/idsOnly), use optimized query
    if (countOnly === '1' || idsOnly === '1') {
      const resp = await fetchIdsOrCount(ownerAddress, idsOnly === '1', withCreatedAt === '1', networkMode);
      return res.status(200).json(resp as any);
    }

    // Fetch positions directly - user-specific data doesn't benefit from server-side Redis caching
    // React Query on the client handles caching for user-specific requests
    const positions = await fetchAndProcessUserPositionsForApi(ownerAddress, networkMode);

    // Ensure all BigInt values are converted to strings before JSON serialization
    return res.status(200).json(serializeBigInts(positions));
  } catch (error: any) {
    // Safely log error (console.error handles BigInts, but we sanitize anyway)
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching positions.";
    console.error(`API Error in /api/liquidity/get-positions for ${ownerAddress}:`, errorMessage);
    return res.status(500).json({ message: errorMessage });
  }
}

// Extracted helper for idsOnly/countOnly to keep main handler clean
async function fetchIdsOrCount(ownerAddress: string, idsOnly: boolean, withCreatedAt: boolean, networkMode: NetworkMode) {
  const hookPositionsQuery = GET_USER_HOOK_POSITIONS_QUERY;

  // Build list of subgraph URLs to query
  const subgraphUrls: string[] = [];
  const primaryUrl = getAlphixSubgraphUrl(networkMode);
  if (primaryUrl) subgraphUrls.push(primaryUrl);

  // Fetch from all subgraphs in parallel (Promise.allSettled pattern identical to Uniswap getPool.ts)
  const subgraphResults = await Promise.allSettled(subgraphUrls.map(async (subgraphUrl) => {
    // AbortController timeout pattern for subgraph fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for subgraph

    try {
      const resp = await fetch(subgraphUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: hookPositionsQuery, variables: { owner: ownerAddress.toLowerCase() } }), signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) return [];
      const json = await resp.json() as any;
      let raw = (json?.data?.hookPositions || []) as SubgraphPosition[];
      if (networkMode === 'testnet' && (!Array.isArray(raw) || raw.length === 0)) {
        try {
          const legacyController = new AbortController();
          const legacyTimeoutId = setTimeout(() => legacyController.abort(), 10000);
          const respLegacy = await fetch(subgraphUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GET_USER_LEGACY_POSITIONS_QUERY, variables: { owner: ownerAddress.toLowerCase() } }), signal: legacyController.signal });
          clearTimeout(legacyTimeoutId);
          if (respLegacy.ok) {
            const jsonLegacy = await respLegacy.json() as any;
            const legacy = (jsonLegacy?.data?.positions || []) as Array<{ id: string; tokenId?: string; owner: string; createdAtTimestamp?: string }>;
            raw = legacy.map(p => ({ id: p.id, owner: p.owner, tickLower: '0', tickUpper: '0', liquidity: '0', creationTimestamp: p.createdAtTimestamp || '0', lastTimestamp: '0', poolId: '' }));
          }
        } catch {}
      }
      return raw;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }));

  // Extract fulfilled results and deduplicate (Uniswap pattern)
  let allRawPositions: SubgraphPosition[] = [];
  const seenPositionIds = new Set<string>();
  for (const result of subgraphResults) {
    if (result.status !== 'fulfilled') continue;
    for (const pos of result.value) { if (!seenPositionIds.has(pos.id)) { seenPositionIds.add(pos.id); allRawPositions.push(pos); } }
  }

  try {
    const raw = allRawPositions;

    // Note: Unified Yield positions are fetched separately in the client layer
    // This API only handles V4 positions for clean architectural separation

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