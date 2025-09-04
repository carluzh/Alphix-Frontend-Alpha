import { revalidateTag } from 'next/cache';

export const runtime = 'nodejs';
export const preferredRegion = 'auto';

// Short global debounce window to avoid hammering with redundant revalidations
let lastGlobalTriggerAt = 0;
const DEBOUNCE_WINDOW_MS = 2_000; // 2s debounce

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || req.headers.get('x-internal-secret') || '';
  const expected = process.env.INTERNAL_API_SECRET || '';
  const isDev = process.env.NODE_ENV !== 'production';

  // In production, allow unsigned client calls; apply a short global debounce instead of per-IP cooldown.
  // If a valid secret is provided, bypass the debounce.
  if (!isDev && (!expected || secret !== expected)) {
    const now = Date.now();
    if (now - lastGlobalTriggerAt < DEBOUNCE_WINDOW_MS) {
      return Response.json({ revalidated: true, message: 'Recently revalidated; skipped duplicate', now }, { headers: { 'Cache-Control': 'no-store' } });
    }
    lastGlobalTriggerAt = now;
  }

  try {
    revalidateTag('pools-batch');
    // Proactively warm the cache so the next user gets fresh data
    try {
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
      if (host) {
        const warmUrl = `${proto}://${host}/api/liquidity/get-pools-batch`;
        await fetch(warmUrl, { method: 'GET' });
      }
    } catch {}
    return Response.json({ revalidated: true, tag: 'pools-batch', now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return Response.json({ message: e?.message || 'Revalidation failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}


