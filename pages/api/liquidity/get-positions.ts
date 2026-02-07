import { ethers } from "ethers";
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress } from "viem";
import { getChainId, getNetworkModeFromRequest, type NetworkMode } from "../../../lib/pools-config";
import { getAlphixSubgraphUrl } from "../../../lib/subgraph-url-helper";
import { fetchUserPositions, type V4ProcessedPosition as SharedV4ProcessedPosition, type Position as SharedPosition } from "@/lib/positions/fetchPositions";

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

// Delegate to shared module (avoids duplication between REST handler and GraphQL resolver)
// Import for local use, re-export for external consumers
import { fetchUserPositions as fetchAndProcessUserPositionsForApi } from "@/lib/positions/fetchPositions";
export { fetchAndProcessUserPositionsForApi };

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