import type { NextApiRequest, NextApiResponse } from 'next';
import { getSubgraphUrlForPool, isDaiPool } from '../../../lib/subgraph-url-helper';
import { cacheService } from '../../../lib/cache/CacheService';

// Subgraph URL selection (Satsuma default with env/query overrides)
const LEGACY_SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";
function selectSubgraphUrl(poolId: string | undefined): string {
  return getSubgraphUrlForPool(poolId) || LEGACY_SUBGRAPH_URL;
}

// DAI subgraph uses currentRatio (Activity), old subgraph uses currentTargetRatio
// Fetch up to 500 events to cover 60+ days of data (some pools have multiple events per day)
const GET_LAST_HOOK_EVENTS_DAI = `
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

const GET_LAST_HOOK_EVENTS_OLD = `
  query GetLastHookEvents($poolId: Bytes!) {
    alphixHooks(
      where: { pool: $poolId }
      orderBy: timestamp
      orderDirection: desc
      first: 500
    ) {
      timestamp
      newFeeBps
      currentTargetRatio
      newTargetRatio
      oldTargetRatio
    }
  }
`;

type HookEvent = {
  timestamp: string;
  newFeeBps?: string;
  newFeeRateBps?: string;
  currentRatio?: string; // DAI subgraph uses this (Activity)
  currentTargetRatio?: string; // Old subgraph uses this
  newTargetRatio?: string;
  oldTargetRatio?: string;
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

  const { poolId, v: versionQuery } = req.query as { poolId?: string; v?: string };
  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
  }

  const cacheKey = `dynamic-fees:${poolId.toLowerCase()}`;

  // Support version-based cache busting
  const version = versionQuery || '';
  const shouldBypassCache = !!(version && version !== 'default');

  try {
    // Use CacheService for Redis-backed caching with stale-while-revalidate
    const result = await cacheService.cachedApiCall<HookEvent[]>(
      cacheKey,
      { fresh: 6 * 60 * 60, stale: 24 * 60 * 60 }, // 6h fresh, 24h stale
      async () => {
        const SUBGRAPH_URL = selectSubgraphUrl(poolId);
        const query = isDaiPool(poolId) ? GET_LAST_HOOK_EVENTS_DAI : GET_LAST_HOOK_EVENTS_OLD;

        const resp = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { poolId: poolId.toLowerCase() } }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Subgraph error: ${body}`);
        }
        const json = await resp.json() as HookResp;
        if (json.errors) {
          throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
        }
        let events = Array.isArray(json.data?.alphixHooks) ? json.data!.alphixHooks! : [];

        // Normalize: DAI pools have currentRatio, old pools have currentTargetRatio
        // Make sure both have currentRatio for consistent frontend usage
        events = events.map(e => ({
          ...e,
          currentRatio: e.currentRatio || e.currentTargetRatio
        }));

        return events;
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


