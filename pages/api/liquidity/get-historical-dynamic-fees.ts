import type { NextApiRequest, NextApiResponse } from 'next';
import { cacheService } from '../../../lib/cache/CacheService';
import { resolveNetworkMode } from '@/lib/network-mode';
import { fetchFeeEvents, type HookEvent } from '@/lib/liquidity/fetchFeeEvents';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HookEvent[] | { error: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { poolId, v: versionQuery } = req.query as { poolId?: string; v?: string };
  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ error: 'Valid poolId query parameter is required.' });
  }

  const networkMode = resolveNetworkMode(req);

  const cacheKey = `dynamic-fees:${poolId.toLowerCase()}:${networkMode}`;

  // Support version-based cache busting
  const version = versionQuery || '';
  const shouldBypassCache = !!(version && version !== 'default');

  try {
    // Use CacheService for Redis-backed caching with stale-while-revalidate
    const result = await cacheService.cachedApiCall<HookEvent[]>(
      cacheKey,
      { fresh: 6 * 60 * 60, stale: 24 * 60 * 60 }, // 6h fresh, 24h stale
      () => fetchFeeEvents(poolId, networkMode),
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
    return res.status(500).json({ error: errorMessage });
  }
}
