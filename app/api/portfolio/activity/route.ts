export const runtime = "nodejs";
export const preferredRegion = "auto";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getAllPools, getToken } from "@/lib/pools-config";
import { batchGetTokenPrices } from "@/lib/price-service";

/**
 * Activity types for portfolio
 */
enum ActivityType {
  SWAP = "swap",
  ADD_LIQUIDITY = "add_liquidity",
  REMOVE_LIQUIDITY = "remove_liquidity",
  COLLECT_FEES = "collect_fees",
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
 * GraphQL query for user transactions
 * Queries swaps, mints (add liquidity), burns (remove liquidity), and collects (fee claims)
 *
 * NOTE: The exact query structure depends on your subgraph schema.
 * This is a general pattern that may need adjustment.
 */
const buildActivityQuery = (limit: number) => `
  query GetUserActivity($owner: String!, $first: Int!) {
    # Swaps involving the user (as sender)
    swaps(
      first: $first
      where: { sender: $owner }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      transaction { id blockNumber }
      timestamp
      pool { id }
      sender
      amount0
      amount1
      amountUSD
    }

    # Mints (add liquidity) for positions owned by user
    mints(
      first: $first
      where: { owner: $owner }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      transaction { id blockNumber }
      timestamp
      pool { id }
      owner
      amount0
      amount1
      amountUSD
    }

    # Burns (remove liquidity) for positions owned by user
    burns(
      first: $first
      where: { owner: $owner }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      transaction { id blockNumber }
      timestamp
      pool { id }
      owner
      amount0
      amount1
      amountUSD
    }

    # Collects (fee claims) for positions owned by user
    collects(
      first: $first
      where: { owner: $owner }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      transaction { id blockNumber }
      timestamp
      pool { id }
      owner
      amount0
      amount1
    }
  }
`;

/**
 * Alternative query using positions to find user activity
 * This may work better depending on your subgraph schema
 */
const buildPositionActivityQuery = (limit: number) => `
  query GetPositionActivity($owner: String!, $first: Int!) {
    positions(
      first: 100
      where: { owner: $owner }
    ) {
      id
      pool {
        id
        token0 { symbol decimals }
        token1 { symbol decimals }
      }
      # Transaction history through position
      transaction { id }
    }
  }
`;

/**
 * Fetch activity data from subgraph
 */
async function fetchActivityFromSubgraph(
  address: string,
  limit: number,
  networkMode: "mainnet" | "testnet"
): Promise<ActivityItem[]> {
  try {
    // Get subgraph URL based on network mode
    const subgraphUrl = networkMode === "mainnet"
      ? process.env.MAINNET_SUBGRAPH_URL
      : process.env.SUBGRAPH_URL;

    if (!subgraphUrl) {
      console.warn("[Activity API] No subgraph URL configured");
      return [];
    }

    // Build and execute query
    const query = buildActivityQuery(limit);
    const variables = {
      owner: address.toLowerCase(),
      first: limit,
    };

    const response = await fetch(subgraphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("[Activity API] Subgraph request failed:", response.status);
      return [];
    }

    const result = await response.json();

    if (result.errors) {
      console.error("[Activity API] Subgraph query errors:", result.errors);
      // Return empty - the query structure may not match the subgraph schema
      return [];
    }

    const data = result.data || {};

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

    // Combine and format activities
    const activities: ActivityItem[] = [];

    // Process swaps
    const swaps = data.swaps || [];
    for (const swap of swaps) {
      const pool = poolMap.get(swap.pool?.id?.toLowerCase());
      const token0Symbol = pool?.token0 || "Token0";
      const token1Symbol = pool?.token1 || "Token1";

      activities.push({
        id: swap.id,
        type: ActivityType.SWAP,
        timestamp: parseInt(swap.timestamp) || 0,
        txHash: swap.transaction?.id || "",
        poolId: swap.pool?.id,
        token0: {
          symbol: token0Symbol,
          amount: formatAmount(swap.amount0 || "0"),
          usdValue: calcUsdValue(swap.amount0, prices[token0Symbol]),
        },
        token1: {
          symbol: token1Symbol,
          amount: formatAmount(swap.amount1 || "0"),
          usdValue: calcUsdValue(swap.amount1, prices[token1Symbol]),
        },
        totalUsdValue: parseFloat(swap.amountUSD || "0"),
      });
    }

    // Process mints (add liquidity)
    const mints = data.mints || [];
    for (const mint of mints) {
      const pool = poolMap.get(mint.pool?.id?.toLowerCase());
      const token0Symbol = pool?.token0 || "Token0";
      const token1Symbol = pool?.token1 || "Token1";

      activities.push({
        id: mint.id,
        type: ActivityType.ADD_LIQUIDITY,
        timestamp: parseInt(mint.timestamp) || 0,
        txHash: mint.transaction?.id || "",
        poolId: mint.pool?.id,
        token0: {
          symbol: token0Symbol,
          amount: formatAmount(mint.amount0 || "0"),
          usdValue: calcUsdValue(mint.amount0, prices[token0Symbol]),
        },
        token1: {
          symbol: token1Symbol,
          amount: formatAmount(mint.amount1 || "0"),
          usdValue: calcUsdValue(mint.amount1, prices[token1Symbol]),
        },
        totalUsdValue: parseFloat(mint.amountUSD || "0"),
      });
    }

    // Process burns (remove liquidity)
    const burns = data.burns || [];
    for (const burn of burns) {
      const pool = poolMap.get(burn.pool?.id?.toLowerCase());
      const token0Symbol = pool?.token0 || "Token0";
      const token1Symbol = pool?.token1 || "Token1";

      activities.push({
        id: burn.id,
        type: ActivityType.REMOVE_LIQUIDITY,
        timestamp: parseInt(burn.timestamp) || 0,
        txHash: burn.transaction?.id || "",
        poolId: burn.pool?.id,
        token0: {
          symbol: token0Symbol,
          amount: formatAmount(burn.amount0 || "0"),
          usdValue: calcUsdValue(burn.amount0, prices[token0Symbol]),
        },
        token1: {
          symbol: token1Symbol,
          amount: formatAmount(burn.amount1 || "0"),
          usdValue: calcUsdValue(burn.amount1, prices[token1Symbol]),
        },
        totalUsdValue: parseFloat(burn.amountUSD || "0"),
      });
    }

    // Process collects (fee claims)
    const collects = data.collects || [];
    for (const collect of collects) {
      const pool = poolMap.get(collect.pool?.id?.toLowerCase());
      const token0Symbol = pool?.token0 || "Token0";
      const token1Symbol = pool?.token1 || "Token1";

      const usd0 = calcUsdValue(collect.amount0, prices[token0Symbol]);
      const usd1 = calcUsdValue(collect.amount1, prices[token1Symbol]);

      activities.push({
        id: collect.id,
        type: ActivityType.COLLECT_FEES,
        timestamp: parseInt(collect.timestamp) || 0,
        txHash: collect.transaction?.id || "",
        poolId: collect.pool?.id,
        token0: {
          symbol: token0Symbol,
          amount: formatAmount(collect.amount0 || "0"),
          usdValue: usd0,
        },
        token1: {
          symbol: token1Symbol,
          amount: formatAmount(collect.amount1 || "0"),
          usdValue: usd1,
        },
        totalUsdValue: (usd0 || 0) + (usd1 || 0),
      });
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
 * Format amount for display
 */
function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "0";
  if (Math.abs(num) < 0.0001) return num.toExponential(2);
  if (Math.abs(num) < 1) return num.toFixed(4);
  if (Math.abs(num) < 1000) return num.toFixed(2);
  return num.toFixed(0);
}

/**
 * Calculate USD value
 */
function calcUsdValue(amount: string | number, price: number | undefined): number | undefined {
  if (!price) return undefined;
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return undefined;
  return Math.abs(num) * price;
}

/**
 * GET /api/portfolio/activity
 *
 * Query parameters:
 * - address: User wallet address (required)
 * - limit: Maximum number of activities to return (default: 10, max: 50)
 * - network: Network mode (mainnet/testnet, default: from request)
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
      : "testnet"; // Default to testnet for now

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
