import type { NextApiRequest, NextApiResponse } from 'next';
import { getSubgraphUrlForPool, isDaiPool } from '../../../lib/subgraph-url-helper';

// Subgraph URL selection (Satsuma default with env/query overrides)
const LEGACY_SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";
function selectSubgraphUrl(poolId: string | undefined): string {
  return getSubgraphUrlForPool(poolId) || LEGACY_SUBGRAPH_URL;
}

// DAI subgraph uses currentRatio (Activity), old subgraph uses currentTargetRatio
const GET_LAST_HOOK_EVENTS_DAI = `
  query GetLastHookEvents($poolId: Bytes!) {
    alphixHooks(
      where: { pool: $poolId }
      orderBy: timestamp
      orderDirection: desc
      first: 60
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
      first: 60
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

// Simple in-memory server cache for this endpoint
const serverCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

  // CDN: cache for 12h, serve stale for 12h while revalidating
  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=43200');

  // Support version-based cache busting
  const version = versionQuery || '';
  const shouldBypassCache = version && version !== 'default';

  // Check cache unless we're bypassing it
  if (!shouldBypassCache) {
    const cached = serverCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return res.status(200).json(cached.data);
    }
  }

  try {
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

    // On success, update cache
    serverCache.set(cacheKey, { data: events, ts: Date.now() });

    return res.status(200).json(events);
  } catch (error: any) {
    console.error(`Fee events API error for pool ${poolId}:`, error);

    // On failure, try to serve from cache
    const cached = serverCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      console.warn(`[dynamic-fees] Serving stale fees for ${poolId} due to fetch error.`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(cached.data);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching fee events';
    return res.status(500).json({ message: errorMessage });
  }
}


