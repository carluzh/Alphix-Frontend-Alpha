import { revalidateTag } from 'next/cache';
import { bumpGlobalVersion, getGlobalVersion } from '@/lib/cache-version';

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
  let targetBlock = 0;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.targetBlock === 'number') targetBlock = Math.max(0, Math.floor(body.targetBlock));
  } catch {}

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
    // Bump global version to force cache miss on subsequent requests
    const newVersion = bumpGlobalVersion();

    revalidateTag('pools-batch');

    // Set client-side invalidation hint (this will be picked up by the page listeners)
    // Note: In serverless, we can't directly modify client localStorage, but we can return it in the response
    // The client will set this when it receives the response
    // Optional: wait for subgraph head to reach targetBlock before warming to avoid stale TVL from lagging index
    try {
      if (targetBlock > 0) {
        const proto = req.headers.get('x-forwarded-proto') || 'https';
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
        if (host) {
          const headUrl = `${proto}://${host}/api/liquidity/subgraph-head`;
          const start = Date.now();
          const timeoutMs = 15000;
          let interval = 300;
          const jitter = () => Math.floor(Math.random() * 120);
          for (;;) {
            const r = await fetch(headUrl, { method: 'GET' });
            if (r.ok) {
              const j = await r.json().catch(() => ({}));
              const head = Number(j?.subgraphHead || 0);
              if (head >= targetBlock) break;
            }
            if (Date.now() - start > timeoutMs) break;
            await new Promise((res) => setTimeout(res, Math.min(1500, interval) + jitter()));
            interval = Math.min(1500, Math.floor(interval * 1.6));
          }
        }
      }
    } catch {}
    // Proactively warm the CDN+server cache so the next user gets fresh data
    try {
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
      if (host) {
        const warmUrl = `${proto}://${host}/api/liquidity/get-pools-batch?v=${newVersion}`;
        // Force CDN to revalidate with origin and refresh its stored object
        await fetch(warmUrl, { method: 'GET', headers: { 'cache-control': 'no-cache' } as any } as any);
      }
    } catch {}
    return new Response(JSON.stringify({
      revalidated: true,
      tag: 'pools-batch',
      version: newVersion,
      now: Date.now()
    }), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json'
      }
    });
  } catch (e: any) {
    return Response.json({ message: e?.message || 'Revalidation failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}


