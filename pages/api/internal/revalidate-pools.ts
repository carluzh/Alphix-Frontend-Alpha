import type { NextApiRequest, NextApiResponse } from 'next';

// Short global debounce window to avoid hammering origin with redundant revalidations
let lastGlobalTriggerAt = 0;
const DEBOUNCE_WINDOW_MS = 2_000; // 2s debounce

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST to avoid accidental crawlers
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: `Method ${req.method} Not Allowed` });
  }

  // Prevent caching of this internal endpoint
  res.setHeader('Cache-Control', 'no-store');

  const provided = (req.headers['x-internal-secret'] || req.query.secret || '') as string;
  const expected = process.env.INTERNAL_API_SECRET || '';
  const isDev = process.env.NODE_ENV !== 'production';

  // In production, allow unsigned client calls; apply a short global debounce instead of per-IP cooldown.
  // If a valid secret is provided, bypass the debounce.
  if (!isDev && (!expected || provided !== expected)) {
    const now = Date.now();
    if (now - lastGlobalTriggerAt < DEBOUNCE_WINDOW_MS) {
      return res.status(200).json({ success: true, message: 'Recently revalidated; skipped duplicate', timestamp: now });
    }
    lastGlobalTriggerAt = now;
  }

  try {
    // Build absolute URL to warm the canonical batch endpoint
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || '';
    if (!host) throw new Error('Host header missing');
    const url = `${proto}://${host}/api/liquidity/get-pools-batch`;

    // Step 1: recompute fresh at origin (no-store)
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        // Try to bypass any intermediary client caches; CDN may ignore, but origin will recompute.
        'cache-control': 'no-cache',
        'x-internal-revalidate': '1',
        ...(expected ? { 'x-internal-secret': expected } : {}),
      } as any,
    } as any);

    const json = await resp.json().catch(() => ({}));
    const poolsCount = Array.isArray(json?.pools) ? json.pools.length : undefined;
    // Step 2: immediately request a cacheable response to warm the edge and server cache
    try {
      await fetch(`${url}?allow_suspicious=1&bust=${Date.now()}`, { method: 'GET' } as any);
    } catch {}
    const now2 = Date.now();
    lastGlobalTriggerAt = now2;
    return res.status(200).json({ success: true, message: 'Revalidate triggered', poolsCount, timestamp: now2 });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || 'Internal error' });
  }
}


