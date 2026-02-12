import type { NextApiRequest, NextApiResponse } from 'next';
import { getUniswapV4SubgraphUrl } from '../../../lib/subgraph-url-helper';
import { cacheService } from '../../../lib/cache/CacheService';
import { getNetworkModeFromRequest, type NetworkMode } from '../../../lib/pools-config';

// Unified query: Both networks use Goldsky subgraph with pool (Bytes) filter
const GET_LAST_HOOK_EVENTS = `
  query GetLastHookEvents($poolId: Bytes!) {
    alphixHooks(
      where: { pool: $poolId }
      orderBy: timestamp
      orderDirection: desc
      first: 500
    ) {
      timestamp
      newFeeBps
      currentRatio
      newTargetRatio
      oldTargetRatio
    }
  }
`;

type HookEvent = {
  timestamp: string;
  newFeeBps?: string;
  currentRatio?: string;      // Current Vol/TVL activity measurement (volatile)
  newTargetRatio?: string;    // New EMA target after this update (smooth)
  oldTargetRatio?: string;    // Previous EMA target before this update
};

type HookResp = { data?: { alphixHooks?: HookEvent[] }, errors?: any[] };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HookEvent[] | { message: string; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { poolId, v: versionQuery, network: networkQuery } = req.query as { poolId?: string; v?: string; network?: string };
  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
  }

  // OVERRIDE: Always use mainnet (testnet removed)
  const networkMode: NetworkMode = 'mainnet';

  const cacheKey = `dynamic-fees:${poolId.toLowerCase()}:${networkMode}`;

  // Support version-based cache busting
  const version = versionQuery || '';
  const shouldBypassCache = !!(version && version !== 'default');

  try {
    // Use CacheService for Redis-backed caching with stale-while-revalidate
    const result = await cacheService.cachedApiCall<HookEvent[]>(
      cacheKey,
      { fresh: 6 * 60 * 60, stale: 24 * 60 * 60 }, // 6h fresh, 24h stale
      async () => {
        const SUBGRAPH_URL = getUniswapV4SubgraphUrl(networkMode);
        const query = GET_LAST_HOOK_EVENTS;

        // AbortController timeout pattern for subgraph fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for subgraph

        const resp = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { poolId: poolId.toLowerCase() } }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Subgraph error: ${body}`);
        }
        const json = await resp.json() as HookResp;
        if (json.errors) {
          throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
        }
        return Array.isArray(json.data?.alphixHooks) ? json.data!.alphixHooks! : [];
      },
      { skipCache: shouldBypassCache }
    );

    // Set cache headers
    res.setHeader('Cache-Control', 'no-store'); // Let Redis handle caching, not CDN
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale');
    }

    return res.status(200).json(result.data);
  } catch (error: any) {
    console.error(`Fee events API error for pool ${poolId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching fee events';
    return res.status(500).json({ message: errorMessage });
  }
}
