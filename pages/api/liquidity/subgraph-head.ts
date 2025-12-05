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

    const [subgraphResp, chainHead] = await Promise.all([
      fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `query __meta { _meta { block { number } } }` }),
      }),
      publicClient.getBlockNumber(),
    ])

    let subgraphHead = 0;
    if (subgraphResp.ok) {
      const json = await subgraphResp.json() as MetaResp;
      subgraphHead = Number(json._meta?.block?.number ?? 0);
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ subgraphHead, chainHead: Number(chainHead) })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed' })
  }
}


