import type { NextApiRequest, NextApiResponse } from 'next'

// These are module singletons inside the target modules; we can't import their Maps directly
// So we expose a minimal in-process registry here.
// To keep changes minimal and safe, we re-execute the target modules and clear their caches via function calls.

// Lazy requires to avoid bundling issues
type AnyHandlerModule = { __getServerCache?: () => Map<string, { data: any; ts: number }> } | any

function tryGetCache(mod: AnyHandlerModule): Map<string, { data: any; ts: number }> | null {
  try {
    if (typeof mod.__getServerCache === 'function') return mod.__getServerCache()
  } catch {}
  return null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` })
  }

  // Basic auth protection via existing middleware token; no body needed beyond ids
  const { poolId, subgraphId } = (req.body || {}) as { poolId?: string; subgraphId?: string }
  if ((!poolId || typeof poolId !== 'string') && (!subgraphId || typeof subgraphId !== 'string')) {
    return res.status(400).json({ message: 'poolId or subgraphId is required' })
  }

  // Best-effort: import the API route modules and clear their internal caches
  try {
    const vol = await import('../liquidity/chart-volume') as unknown as AnyHandlerModule
    const tvl = await import('../liquidity/chart-tvl') as unknown as AnyHandlerModule

    let cleared = 0
    const targets = [vol, tvl]
    for (const m of targets) {
      const get = (m as any).__getServerCache as (() => Map<string, { data: any; ts: number }>) | undefined
      if (typeof get === 'function') {
        const map = get()
        const keys = Array.from(map.keys())
        for (const k of keys) {
          const s = k.toLowerCase()
          const pid = (poolId || '').toLowerCase()
          const sid = (subgraphId || '').toLowerCase()
          if ((pid && s.includes(pid)) || (sid && s.includes(sid))) {
            map.delete(k)
            cleared++
          }
        }
      }
    }

    return res.status(200).json({ success: true, cleared })
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Failed to revalidate' })
  }
}


