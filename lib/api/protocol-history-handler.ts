/**
 * Shared handler factory for the protocol history proxy routes.
 *
 * The three protocol history endpoints (tvl / volume / user-revenue) were
 * byte-for-byte identical apart from the upstream backend path, the Redis
 * cache key, the log tag, and the error message. They all proxy a backend
 * GET that returns `{ success, data: [...] }`, cache it with the same
 * stale-while-revalidate contract (5min fresh / 15min stale), and re-emit
 * `{ success, data }` with `Cache-Control: public, s-maxage=300,
 * stale-while-revalidate=900`. This factory captures that shared shape.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { cacheService } from '@/lib/cache/CacheService'
import { buildBackendUrlNoNetwork } from '@/lib/backend-client'

// 5min fresh, 15min stale — identical across all protocol history routes.
const CACHE_TTL = { fresh: 300, stale: 900 }

interface BackendHistoryResponse<T> {
  success: boolean
  data: T[]
}

export interface ProtocolHistoryHandlerConfig {
  /** Backend path proxied verbatim, e.g. `/protocol/tvl/history`. */
  upstreamPath: string
  /** Redis cache key, e.g. `protocol:tvl-history`. */
  cacheKey: string
  /** Log tag for `[protocol/<logTag>]` console output, e.g. `tvl-history`. */
  logTag: string
  /** User-facing 500 message, e.g. `Failed to fetch TVL history`. */
  errorMessage: string
}

/**
 * Build a Next.js API handler that proxies a backend protocol history series
 * with stale-while-revalidate caching. The point shape is passed through
 * verbatim, so `T` is purely cosmetic for callers that want a typed result.
 */
export function createProtocolHistoryHandler<T = unknown>(config: ProtocolHistoryHandlerConfig) {
  const { upstreamPath, cacheKey, logTag, errorMessage } = config

  async function fetchHistory(): Promise<T[]> {
    const url = buildBackendUrlNoNetwork(upstreamPath)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`)
      }

      const json: BackendHistoryResponse<T> = await response.json()
      if (!json.success || !Array.isArray(json.data)) {
        throw new Error('Invalid response shape')
      }

      return json.data
    } finally {
      clearTimeout(timeout)
    }
  }

  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET'])
      return res.status(405).json({ error: `Method ${req.method} Not Allowed` })
    }

    try {
      const result = await cacheService.cachedApiCall(
        cacheKey,
        CACHE_TTL,
        () => fetchHistory(),
        { shouldCache: (data) => Array.isArray(data) && data.length > 0 },
      )

      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
      if (result.isStale) {
        res.setHeader('X-Cache-Status', 'stale')
      }

      return res.status(200).json({ success: true, data: result.data })
    } catch (error) {
      console.error(`[protocol/${logTag}] Error:`, error)
      return res.status(500).json({ success: false, error: errorMessage })
    }
  }
}
