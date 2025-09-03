import type { NextApiRequest, NextApiResponse } from 'next';

// Subgraph URL selection (Satsuma default with env/query overrides)
const LEGACY_SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";
function selectSubgraphUrl(_req: NextApiRequest): string {
  const envDefault = process.env.NEXT_PUBLIC_SUBGRAPH_URL || process.env.SUBGRAPH_URL;
  return envDefault || LEGACY_SUBGRAPH_URL;
}

// Minimal query: last 60 hook events for a pool (latest first)
// Use oldTargetRatio rather than newTargetRatio
const GET_LAST_HOOK_EVENTS = `
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
      oldTargetRatio
    }
  }
`;

type HookEvent = {
  timestamp: string;
  newFeeBps?: string;
  newFeeRateBps?: string;
  currentTargetRatio?: string;
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

  const { poolId } = req.query;
  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
  }

  const cacheKey = `dynamic-fees:${poolId.toLowerCase()}`;
  
  // CDN: cache for 12h, serve stale for 12h while revalidating
  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=43200');

  try {
    const SUBGRAPH_URL = selectSubgraphUrl(req);
    const resp = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GET_LAST_HOOK_EVENTS, variables: { poolId: poolId.toLowerCase() } }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Subgraph error: ${body}`);
    }
    const json = await resp.json() as HookResp;
    if (json.errors) {
      throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
    }
    const events = Array.isArray(json.data?.alphixHooks) ? json.data!.alphixHooks! : [];

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


