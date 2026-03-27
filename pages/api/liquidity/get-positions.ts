import { ethers } from "ethers";
import type { NextApiRequest, NextApiResponse } from 'next';
import { type NetworkMode } from "../../../lib/pools-config";
import { resolveNetworkMode } from "../../../lib/network-mode";
import { getAllAlphixSubgraphUrls } from "../../../lib/subgraph-url-helper";
import { fetchUserPositions } from "@/lib/positions/fetchPositions";

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
    poolId: string;
}

// All networks use poolId directly (Goldsky subgraph)
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

    /** Chain this position lives on — set by the page that creates the ProcessedPosition.
     *  Used by action modals (add/remove/collect) to target the correct chain. */
    networkMode: NetworkMode;
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

// Helper to parse tokenId from composite subgraph id (last dash component hex)
function parseTokenIdFromHexId(idHex: string): bigint | null {
    try {
        if (!idHex || !idHex.startsWith('0x')) return null;
        return BigInt(idHex);
    } catch { return null; }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Position[] | { error: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const networkMode = resolveNetworkMode(req);

  const { ownerAddress, countOnly, idsOnly, withCreatedAt } = req.query as { ownerAddress?: string; countOnly?: string; idsOnly?: string; withCreatedAt?: string };

  if (!ownerAddress || typeof ownerAddress !== 'string' || !ethers.utils.isAddress(ownerAddress)) {
    return res.status(400).json({ error: 'Valid ownerAddress query parameter is required.' });
  }

  try {
    // For lightweight modes (countOnly/idsOnly), use optimized query
    if (countOnly === '1' || idsOnly === '1') {
      const resp = await fetchIdsOrCount(ownerAddress, idsOnly === '1', withCreatedAt === '1', networkMode);
      return res.status(200).json(resp as any);
    }

    // Fetch positions directly - user-specific data doesn't benefit from server-side Redis caching
    // React Query on the client handles caching for user-specific requests
    const positions = await fetchUserPositions(ownerAddress, networkMode);

    // Ensure all BigInt values are converted to strings before JSON serialization
    return res.status(200).json(serializeBigInts(positions));
  } catch (error: any) {
    // Safely log error (console.error handles BigInts, but we sanitize anyway)
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching positions.";
    console.error(`API Error in /api/liquidity/get-positions for ${ownerAddress}:`, errorMessage);
    return res.status(500).json({ error: errorMessage });
  }
}

// Extracted helper for idsOnly/countOnly to keep main handler clean
async function fetchIdsOrCount(ownerAddress: string, idsOnly: boolean, withCreatedAt: boolean, networkMode: NetworkMode) {
  const hookPositionsQuery = GET_USER_HOOK_POSITIONS_QUERY;

  // Build list of subgraph URLs to query
  const subgraphUrls = getAllAlphixSubgraphUrls(networkMode);

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
      const raw = (json?.data?.hookPositions || []) as SubgraphPosition[];
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
        return { count: raw.length };
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
    return idsOnly ? [] : { count: 0 };
  }
} 