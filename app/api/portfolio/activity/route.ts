export const runtime = "nodejs";
export const preferredRegion = "auto";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getAllPools } from "@/lib/pools-config";
import { batchGetTokenPrices } from "@/lib/price-service";
import { getAlphixSubgraphUrl, getDaiSubgraphUrl, isMainnetSubgraphMode } from "@/lib/subgraph-url-helper";

/**
 * Activity types for portfolio
 */
enum ActivityType {
  ADD_LIQUIDITY = "add_liquidity",
  MODIFY_LIQUIDITY = "modify_liquidity",
  UNKNOWN = "unknown",
}

interface ActivityToken {
  symbol: string;
  amount: string;
  usdValue?: number;
}

interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: number;
  txHash: string;
  token0?: ActivityToken;
  token1?: ActivityToken;
  totalUsdValue?: number;
  poolId?: string;
}

/**
 * GraphQL query for user positions with timestamps
 * V4 subgraph uses hookPositions entity
 */
const GET_POSITION_ACTIVITY_TESTNET = `
  query GetPositionActivity($owner: Bytes!, $first: Int!) {
    hookPositions(
      first: $first
      where: { owner: $owner }
      orderBy: creationTimestamp
      orderDirection: desc
    ) {
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

const GET_POSITION_ACTIVITY_MAINNET = `
  query GetPositionActivity($owner: Bytes!, $first: Int!) {
    hookPositions(
      first: $first
      where: { owner: $owner }
      orderBy: creationTimestamp
      orderDirection: desc
    ) {
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

interface SubgraphPosition {
  id: string;
  owner: string;
  tickLower: string;
  tickUpper: string;
  liquidity: string;
  creationTimestamp: string;
  lastTimestamp: string;
  pool?: { id: string };
  poolId?: string;
}

function getPoolIdFromPosition(pos: SubgraphPosition): string {
  return pos.poolId || pos.pool?.id || '';
}

/**
 * Fetch activity data from subgraph - derived from position timestamps
 */
async function fetchActivityFromSubgraph(
  address: string,
  limit: number,
  networkMode: "mainnet" | "testnet"
): Promise<ActivityItem[]> {
  try {
    const isMainnet = isMainnetSubgraphMode(networkMode);
    const query = isMainnet ? GET_POSITION_ACTIVITY_MAINNET : GET_POSITION_ACTIVITY_TESTNET;

    // Get subgraph URLs
    const subgraphUrls: string[] = [];
    const primaryUrl = getAlphixSubgraphUrl(networkMode);
    if (primaryUrl) subgraphUrls.push(primaryUrl);

    if (!isMainnet) {
      const daiUrl = getDaiSubgraphUrl(networkMode);
      if (daiUrl && daiUrl !== primaryUrl) {
        subgraphUrls.push(daiUrl);
      }
    }

    if (subgraphUrls.length === 0) {
      console.warn("[Activity API] No subgraph URL configured");
      return [];
    }

    // Fetch from all subgraphs in parallel
    const subgraphResults = await Promise.allSettled(
      subgraphUrls.map(async (subgraphUrl) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await fetch(subgraphUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query,
              variables: { owner: address.toLowerCase(), first: limit * 2 },
            }),
            signal: controller.signal,
            cache: "no-store",
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            return [];
          }

          const result = await response.json();
          if (result.errors) {
            console.error("[Activity API] Subgraph query errors:", result.errors);
            return [];
          }

          return (result.data?.hookPositions || []) as SubgraphPosition[];
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      })
    );

    // Deduplicate positions from all subgraphs
    const allPositions: SubgraphPosition[] = [];
    const seenIds = new Set<string>();
    for (const result of subgraphResults) {
      if (result.status !== "fulfilled") continue;
      for (const pos of result.value) {
        if (!seenIds.has(pos.id)) {
          seenIds.add(pos.id);
          allPositions.push(pos);
        }
      }
    }

    // Get pool configs for token mapping
    const pools = getAllPools();
    const poolMap = new Map(pools.map((p: any) => [p.subgraphId?.toLowerCase(), p]));

    // Get prices for USD conversion
    const allSymbols = new Set<string>();
    pools.forEach((p: any) => {
      if (p.token0) allSymbols.add(p.token0);
      if (p.token1) allSymbols.add(p.token1);
    });
    const prices = await batchGetTokenPrices(Array.from(allSymbols));

    // Convert positions to activity items
    const activities: ActivityItem[] = [];

    for (const pos of allPositions) {
      const poolId = getPoolIdFromPosition(pos);
      const pool = poolMap.get(poolId?.toLowerCase());
      const token0Symbol = pool?.token0 || "Token0";
      const token1Symbol = pool?.token1 || "Token1";
      const creationTs = parseInt(pos.creationTimestamp) || 0;
      const lastTs = parseInt(pos.lastTimestamp) || 0;

      // Add creation activity
      if (creationTs > 0) {
        activities.push({
          id: `${pos.id}-create`,
          type: ActivityType.ADD_LIQUIDITY,
          timestamp: creationTs,
          txHash: "", // Not available in position data
          poolId,
          token0: {
            symbol: token0Symbol,
            amount: "0", // Position amounts require on-chain calculation
            usdValue: undefined,
          },
          token1: {
            symbol: token1Symbol,
            amount: "0",
            usdValue: undefined,
          },
          totalUsdValue: undefined,
        });
      }

      // Add modification activity if lastTimestamp differs from creation
      if (lastTs > 0 && lastTs !== creationTs) {
        activities.push({
          id: `${pos.id}-modify`,
          type: ActivityType.MODIFY_LIQUIDITY,
          timestamp: lastTs,
          txHash: "",
          poolId,
          token0: {
            symbol: token0Symbol,
            amount: "0",
            usdValue: undefined,
          },
          token1: {
            symbol: token1Symbol,
            amount: "0",
            usdValue: undefined,
          },
          totalUsdValue: undefined,
        });
      }
    }

    // Sort by timestamp (newest first) and limit
    activities.sort((a, b) => b.timestamp - a.timestamp);
    return activities.slice(0, limit);
  } catch (error) {
    console.error("[Activity API] Error fetching activity:", error);
    return [];
  }
}

/**
 * GET /api/portfolio/activity
 *
 * Query parameters:
 * - address: User wallet address (required)
 * - limit: Maximum number of activities to return (default: 10, max: 50)
 * - network: Network mode (mainnet/testnet, default: testnet)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const address = searchParams.get("address");
    const limitParam = searchParams.get("limit");
    const networkParam = searchParams.get("network");

    // Validate address
    if (!address) {
      return NextResponse.json(
        { success: false, error: "Address is required" },
        { status: 400 }
      );
    }

    // Parse limit with bounds
    const limit = Math.min(Math.max(parseInt(limitParam || "10") || 10, 1), 50);

    // Determine network mode
    const networkMode = (networkParam === "mainnet" || networkParam === "testnet")
      ? networkParam
      : "testnet";

    // Fetch activity
    const activities = await fetchActivityFromSubgraph(address, limit, networkMode);

    return NextResponse.json({
      success: true,
      activities,
      count: activities.length,
      address,
      networkMode,
    });
  } catch (error) {
    console.error("[Activity API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        activities: [],
      },
      { status: 500 }
    );
  }
}
