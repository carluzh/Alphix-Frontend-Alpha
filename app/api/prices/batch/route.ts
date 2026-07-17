export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { batchQuotePrices } from '@/lib/swap/quote-prices';
import { modeForChainId, type NetworkMode, CHAIN_REGISTRY } from '@/lib/network-mode';
import { checkRateLimit } from '@/lib/api/ratelimit';
import { reportError } from '@/lib/observability';

/**
 * POST /api/prices/batch
 * Body: { symbols: string[], chainId?: number }
 * Returns: { prices: Record<string, number>, timestamp: number }
 *
 * Batch-fetches USD prices for multiple tokens via backend pool metrics + CoinGecko fallback + Redis cache.
 * Server-side Redis caching (60s fresh / 5min stale) prevents excessive RPC calls.
 */
export async function POST(request: Request) {
  const rateLimited = await checkRateLimit(request);
  if (rateLimited) return rateLimited;

  let chainId: number | undefined;
  let symbolsCount: number | undefined;

  try {
    const body = await request.json();
    const symbols: string[] = body.symbols || [];
    chainId = parseInt(body.chainId || String(CHAIN_REGISTRY.base.chainId), 10);
    symbolsCount = Array.isArray(symbols) ? symbols.length : 0;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 });
    }

    const capped = symbols.slice(0, 50);
    const networkMode: NetworkMode = modeForChainId(chainId) ?? 'base';
    const prices = await batchQuotePrices(capped, chainId, networkMode);

    return NextResponse.json(
      { prices, timestamp: Date.now() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    // Client-aborted / truncated request (socket closed mid-read while we awaited
    // request.json()). Not an app bug — skip reporting AND the console.error so it
    // is not forwarded by consoleLoggingIntegration. The 500 below is moot since
    // the client is already gone.
    if (isClientAbortError(error)) {
      return NextResponse.json({ error: 'aborted' }, { status: 499 });
    }
    console.error('[/api/prices/batch] Error:', error);
    reportError(error, {
      domain: 'backend',
      action: 'batchPrices',
      component: 'api/prices/batch',
      chainId,
      extras: { symbolsCount },
    });
    return NextResponse.json(
      { error: 'Failed to fetch prices' },
      { status: 500 }
    );
  }
}

/**
 * Detect a client-aborted request: the socket closed before the body finished
 * (Error: 'aborted'), an abort signal fired (AbortError / err.name), or the
 * connection reset (ECONNRESET). These are not server faults and must not be
 * reported as errors.
 */
function isClientAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  return (
    name === 'AbortError' ||
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    message === 'aborted' ||
    message.includes('Unexpected end of form')
  );
}
