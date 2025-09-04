export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { getGlobalVersion, debugVersion } from '@/lib/cache-version';

// Lazy TTL bumping: if current version is older than TTL, bump it here
let lastServedVersionAgeMs = 0; // ephemeral, best-effort

export async function GET() {
  let version = getGlobalVersion();
  const debug = debugVersion();
  const now = Date.now();
  const isExpired = debug.age > debug.ttl;
  if (isExpired) {
    // bump by calling the same global bump used by actions (import inline to avoid cycle)
    const { bumpGlobalVersion } = await import('@/lib/cache-version');
    version = bumpGlobalVersion();
    lastServedVersionAgeMs = 0;
  } else {
    lastServedVersionAgeMs = debug.age;
  }

  return new Response(JSON.stringify({
    version,
    cacheUrl: `/api/liquidity/get-pools-batch?v=${version}`,
    ttl: debug.ttl,
    expiresAt: debug.expiresAt,
    age: isExpired ? 0 : debug.age
  }), {
    headers: {
      // Avoid CDN caching this; clients should always see the latest global version
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json'
    }
  });
}
