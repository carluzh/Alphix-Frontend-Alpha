export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { batchQuotePrices } from '@/lib/swap/quote-prices';
import { MAINNET_CHAIN_ID, type NetworkMode } from '@/lib/network-mode';

/**
 * POST /api/prices/batch
 * Body: { symbols: string[], chainId?: number }
 * Returns: { prices: Record<string, number>, timestamp: number }
 *
 * Batch-fetches USD prices for multiple tokens via V4 Quoter + CoinGecko fallback.
 * Server-side Redis caching (60s fresh / 5min stale) prevents excessive RPC calls.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbols: string[] = body.symbols || [];
    const chainId = parseInt(body.chainId || '8453', 10);

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 });
    }

    const capped = symbols.slice(0, 50);
    const networkMode: NetworkMode = chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet';
    const prices = await batchQuotePrices(capped, chainId, networkMode);

    return NextResponse.json(
      { prices, timestamp: Date.now() },
      { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' } }
    );
  } catch (error) {
    console.error('[/api/prices/batch] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prices' },
      { status: 500 }
    );
  }
}
