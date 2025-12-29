import type { NextApiRequest, NextApiResponse } from 'next'
import { createNetworkClient } from '@/lib/viemClient'
import { getNetworkModeFromCookies } from '@/lib/network-mode'
import { getAlphixSubgraphUrl } from '@/lib/subgraph-url-helper'

type MetaResp = { _meta?: { block?: { number?: number } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get network mode from cookies (defaults to env var for new users)
    const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    const networkMode = getNetworkModeFromCookies(req.headers.cookie) || envDefault;
    const publicClient = createNetworkClient(networkMode);

    const subgraphUrl = getAlphixSubgraphUrl(networkMode);

    // Promise.allSettled pattern (identical to Uniswap getPool.ts)
    // AbortController timeout pattern for subgraph fetch
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s for subgraph

    const [subgraphResult, chainHeadResult] = await Promise.allSettled([
      fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `query __meta { _meta { block { number } } }` }),
        signal: controller.signal,
      }),
      publicClient.getBlockNumber(),
    ])

    clearTimeout(timeoutId)

    // Extract results with graceful fallbacks
    let subgraphHead = 0;
    if (subgraphResult.status === 'fulfilled' && subgraphResult.value.ok) {
      const json = await subgraphResult.value.json() as MetaResp;
      subgraphHead = Number(json._meta?.block?.number ?? 0);
    }

    const chainHead = chainHeadResult.status === 'fulfilled' ? chainHeadResult.value : 0n;

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ subgraphHead, chainHead: Number(chainHead) })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed' })
  }
}


