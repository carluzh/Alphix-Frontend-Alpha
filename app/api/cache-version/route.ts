export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { getGlobalVersion, debugVersion } from '@/lib/cache-version';

export async function GET() {
  const version = getGlobalVersion();
  const debug = debugVersion();

  return Response.json({
    version,
    cacheUrl: `/api/liquidity/get-pools-batch?v=${version}`,
    ttl: debug.ttl,
    expiresAt: debug.expiresAt,
    age: debug.age
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=60' } // Cache version info for 1 minute
  });
}
