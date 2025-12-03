import { getAllPools, getToken, type NetworkMode } from './pools-config';

export interface SwapRoute {
  path: string[]; // Array of token symbols in order [from, intermediate1, intermediate2, ..., to]
  pools: PoolHop[]; // Array of pool information for each hop
  hops: number; // Number of hops (pools.length)
  isDirectRoute: boolean; // True if single hop, false if multi-hop
}

export interface PoolHop {
  poolId: string;
  poolName: string;
  token0: string; // Token symbol
  token1: string; // Token symbol
  fee: number;
  tickSpacing: number;
  hooks: string;
  subgraphId: string;
}

export interface RouteResult {
  bestRoute: SwapRoute | null;
  allRoutes: SwapRoute[];
  hasDirectRoute: boolean;
}

/**
 * Build a graph representation of all available pools for pathfinding
 */
function buildPoolGraph(networkMode?: NetworkMode): Map<string, PoolHop[]> {
  const graph = new Map<string, PoolHop[]>();
  const allPools = getAllPools(networkMode);

  // Initialize empty arrays for each token
  const allTokens = new Set<string>();
  Object.values(allPools).forEach(pool => {
    allTokens.add(pool.currency0.symbol);
    allTokens.add(pool.currency1.symbol);
  });

  allTokens.forEach(token => {
    graph.set(token, []);
  });

  // Add pool connections to the graph
  Object.values(allPools).forEach(pool => {
    const poolHop: PoolHop = {
      poolId: pool.id,
      poolName: pool.name,
      token0: pool.currency0.symbol,
      token1: pool.currency1.symbol,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks: pool.hooks,
      subgraphId: pool.subgraphId
    };

    // Add bidirectional connections
    graph.get(pool.currency0.symbol)?.push(poolHop);
    graph.get(pool.currency1.symbol)?.push(poolHop);
  });

  return graph;
}

/**
 * Find all possible routes between two tokens using BFS with max depth
 */
function findAllRoutes(
  fromToken: string,
  toToken: string,
  maxHops: number = 3,
  networkMode?: NetworkMode
): SwapRoute[] {
  if (fromToken === toToken) {
    return [];
  }

  const graph = buildPoolGraph(networkMode);
  const routes: SwapRoute[] = [];
  
  // BFS queue: [currentToken, path, usedPools, visitedTokens]
  const queue: [string, string[], PoolHop[], Set<string>][] = [
    [fromToken, [fromToken], [], new Set([fromToken])]
  ];

  while (queue.length > 0) {
    const [currentToken, path, usedPools, visitedTokens] = queue.shift()!;
    
    // Skip if we've exceeded max hops
    if (usedPools.length >= maxHops) {
      continue;
    }

    const connections = graph.get(currentToken) || [];
    
    for (const poolHop of connections) {
      // Determine the next token (the one that's not the current token)
      const nextToken = poolHop.token0 === currentToken 
        ? poolHop.token1 
        : poolHop.token0;
      
      // Skip if we've already visited this token (prevent cycles)
      if (visitedTokens.has(nextToken)) {
        continue;
      }

      // Skip if we've already used this exact pool
      if (usedPools.some(pool => pool.poolId === poolHop.poolId)) {
        continue;
      }

      const newPath = [...path, nextToken];
      const newUsedPools = [...usedPools, poolHop];
      const newVisitedTokens = new Set([...visitedTokens, nextToken]);

      // If we reached the target token, add this route
      if (nextToken === toToken) {
        routes.push({
          path: newPath,
          pools: newUsedPools,
          hops: newUsedPools.length,
          isDirectRoute: newUsedPools.length === 1
        });
      } else {
        // Continue exploring from this token
        queue.push([nextToken, newPath, newUsedPools, newVisitedTokens]);
      }
    }
  }

  return routes;
}

/**
 * Score routes based on various factors (fewer hops is better, known pool reliability, etc.)
 */
function scoreRoute(route: SwapRoute): number {
  let score = 0;

  // Heavily favor direct routes
  if (route.isDirectRoute) {
    score += 1000;
  }

  // Penalty for each additional hop (exponential)
  score -= Math.pow(route.hops, 2) * 100;

  // Bonus for pools with tighter tick spacing (more precise)
  route.pools.forEach(pool => {
    if (pool.tickSpacing <= 1) score += 50;      // Very tight spacing
    else if (pool.tickSpacing <= 10) score += 30; // Tight spacing  
    else if (pool.tickSpacing <= 60) score += 10; // Normal spacing
    // No bonus for wide spacing
  });

  // Bonus for stablecoin pairs (lower slippage typically)
  // Include both mainnet (USDC, USDT) and testnet (aUSDC, aUSDT) stablecoins
  const stablecoins = ['USDC', 'USDT', 'DAI', 'aUSDC', 'aUSDT', 'aDAI'];
  route.pools.forEach(pool => {
    const isStablePair = stablecoins.includes(pool.token0) && stablecoins.includes(pool.token1);
    if (isStablePair) score += 25;
  });

  return score;
}

/**
 * Main function to find the best route between two tokens
 */
export function findBestRoute(fromToken: string, toToken: string, networkMode?: NetworkMode): RouteResult {
  console.log(`[RoutingEngine] Finding routes from ${fromToken} to ${toToken}`);

  // Validate tokens exist
  const fromTokenConfig = getToken(fromToken, networkMode);
  const toTokenConfig = getToken(toToken, networkMode);

  if (!fromTokenConfig || !toTokenConfig) {
    console.error(`[RoutingEngine] Invalid tokens: ${fromToken} or ${toToken} not found`);
    return {
      bestRoute: null,
      allRoutes: [],
      hasDirectRoute: false
    };
  }

  // Find all possible routes
  const allRoutes = findAllRoutes(fromToken, toToken, 3, networkMode); // Max 3 hops
  
  if (allRoutes.length === 0) {
    console.warn(`[RoutingEngine] No routes found from ${fromToken} to ${toToken}`);
    return {
      bestRoute: null,
      allRoutes: [],
      hasDirectRoute: false
    };
  }

  // Score and sort routes
  const scoredRoutes = allRoutes.map(route => ({
    route,
    score: scoreRoute(route)
  })).sort((a, b) => b.score - a.score); // Highest score first

  const bestRoute = scoredRoutes[0].route;
  const hasDirectRoute = allRoutes.some(route => route.isDirectRoute);

  console.log(`[RoutingEngine] Found ${allRoutes.length} routes. Best route: ${bestRoute.path.join(' → ')} (${bestRoute.hops} hops)`);
  
  return {
    bestRoute,
    allRoutes,
    hasDirectRoute
  };
}

/**
 * Get a direct route if one exists (for simple validation)
 */
export function getDirectRoute(fromToken: string, toToken: string, networkMode?: NetworkMode): SwapRoute | null {
  const result = findBestRoute(fromToken, toToken, networkMode);
  return result.hasDirectRoute ? result.allRoutes.find(route => route.isDirectRoute) || null : null;
}

/**
 * Check if a direct route exists between two tokens
 */
export function hasDirectRoute(fromToken: string, toToken: string, networkMode?: NetworkMode): boolean {
  return getDirectRoute(fromToken, toToken, networkMode) !== null;
}

/**
 * Get all intermediate tokens in a route (excluding start and end)
 */
export function getIntermediateTokens(route: SwapRoute): string[] {
  if (route.path.length <= 2) {
    return []; // No intermediate tokens
  }
  return route.path.slice(1, -1); // Remove first and last
}

/**
 * Convert route to readable string representation
 */
export function routeToString(route: SwapRoute): string {
  const pathStr = route.path.join(' → ');
  const hopStr = route.hops === 1 ? '1 hop' : `${route.hops} hops`;
  return `${pathStr} (${hopStr})`;
} 