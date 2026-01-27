export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getQuotePrice } from '@/lib/swap/quote-prices';
import { MAINNET_CHAIN_ID, type NetworkMode } from '@/lib/network-mode';

/**
 * GET /api/prices/get-token-price?symbol=ETH&chainId=8453
 *
 * Returns Redis-cached token price in USD.
 * Uses stale-while-revalidate pattern to minimize RPC calls.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const chainId = parseInt(searchParams.get('chainId') || '8453', 10);

  if (!symbol) {
    return NextResponse.json({ error: 'symbol parameter required' }, { status: 400 });
  }

  const networkMode: NetworkMode = chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet';
  const price = await getQuotePrice(symbol, chainId, networkMode);

  return NextResponse.json(
    { symbol, price, chainId },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
  );
}
