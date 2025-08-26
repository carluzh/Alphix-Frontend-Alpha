import type { NextApiRequest, NextApiResponse } from 'next';

// Subgraph URL selection (Satsuma default with env/query overrides)
const LEGACY_SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";
function selectSubgraphUrl(_req: NextApiRequest): string {
  const envDefault = process.env.NEXT_PUBLIC_SUBGRAPH_URL || process.env.SUBGRAPH_URL;
  return envDefault || LEGACY_SUBGRAPH_URL;
}

// Minimal query: last 60 hook events for a pool (latest first)
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
      newTargetRatio
    }
  }
`;

type HookEvent = {
  timestamp: string;
  newFeeBps?: string;
  newFeeRateBps?: string;
  currentTargetRatio?: string;
  newTargetRatio?: string;
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

  const { poolId } = req.query;
  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
  }

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
    return res.status(200).json(events);
  } catch (error: any) {
    console.error(`Fee events API error for pool ${poolId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching fee events';
    const detailedError = process.env.NODE_ENV === 'development' ? { name: (error as any)?.name, stack: (error as any)?.stack } : {};
    return res.status(500).json({ message: errorMessage, error: detailedError });
  }
}


