import type { NextApiRequest, NextApiResponse } from 'next'
import { executeSubgraphQuery } from '@/lib/subgraphClient'
import { publicClient } from '@/lib/viemClient'

type MetaResp = { _meta?: { block?: { number?: number } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const [{ _meta }, chainHead] = await Promise.all([
      executeSubgraphQuery<MetaResp>({ query: `query __meta { _meta { block { number } } }` }, { maxRetries: 2, timeoutMs: 6000 }),
      publicClient.getBlockNumber(),
    ])
    const subgraphHead = Number(_meta?.block?.number ?? 0)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ subgraphHead, chainHead: Number(chainHead) })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed' })
  }
}


