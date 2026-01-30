import type { NextApiRequest, NextApiResponse } from 'next'
import { getPoolSubgraphId, getNetworkModeFromRequest } from '../../../lib/pools-config'
import { getUniswapV4SubgraphUrl } from '../../../lib/subgraph-url-helper'
import { cacheService } from '@/lib/cache/CacheService'
import { poolKeys } from '@/lib/cache/redis-keys'

// Cache TTL configuration (in seconds)
const CACHE_TTL = { fresh: 300, stale: 3600 } // 5min fresh, 1hr stale

// Uniswap Gateway configuration (same as pool-price-history.ts)
const UNISWAP_GATEWAY = 'https://interface.gateway.uniswap.org/v1/graphql'
const UNISWAP_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://app.uniswap.org',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

type TickRow = {
  tickIdx: string | number
  liquidityGross: string
  liquidityNet: string
}

/**
 * Fetch tick data from the Uniswap Gateway API (mainnet only).
 * Uses the v4Pool query with spoofed Origin header.
 */
async function fetchUniswapGatewayTicks(poolId: string): Promise<TickRow[] | null> {
  const query = `query GetPoolTicks($poolId: String!) {
    v4Pool(chain: BASE, poolId: $poolId) {
      ticks {
        tickIdx
        liquidityGross
        liquidityNet
      }
    }
  }`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s for external API

  try {
    const response = await fetch(UNISWAP_GATEWAY, {
      method: 'POST',
      headers: UNISWAP_HEADERS,
      body: JSON.stringify({ query, variables: { poolId } }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`[get-ticks] Uniswap Gateway returned ${response.status}`)
      return null
    }

    const data = await response.json()

    if (data.errors?.length) {
      console.warn('[get-ticks] Uniswap Gateway errors:', data.errors)
      return null
    }

    const ticks = data.data?.v4Pool?.ticks
    if (!Array.isArray(ticks)) {
      return null
    }

    return ticks as TickRow[]
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn('[get-ticks] Uniswap Gateway error:', error)
    return null
  }
}

/**
 * Fetch tick data from subgraph (testnet fallback).
 */
async function fetchSubgraphTicks(poolId: string, limit: number, networkMode: 'testnet'): Promise<TickRow[] | null> {
  const subgraphUrl = getUniswapV4SubgraphUrl(networkMode)
  const query = `
    query GetTicks($pool: Bytes!, $first: Int!) {
      ticks(
        first: $first
        where: { pool: $pool }
        orderBy: tickIdx
        orderDirection: asc
      ) {
        tickIdx
        liquidityGross
        liquidityNet
      }
    }
  `

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s for subgraph

  try {
    const response = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { pool: poolId, first: limit },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Subgraph request failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (data.errors) {
      throw new Error(`Subgraph query error: ${data.errors[0]?.message || 'Unknown error'}`)
    }

    return (data.data?.ticks || []) as TickRow[]
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn('[get-ticks] Subgraph error:', error)
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie)

  try {
    const { poolId, first = 500 } = req.body ?? {}

    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ error: 'Missing poolId in body' })
    }

    const limit = Math.min(Number(first) || 500, 1000)
    const apiId = getPoolSubgraphId(poolId, networkMode) || poolId

    // Use CacheService for tick data with stale-while-revalidate
    const result = await cacheService.cachedApiCall(
      poolKeys.ticks(apiId, networkMode),
      CACHE_TTL,
      async () => {
        if (networkMode === 'mainnet') {
          // Mainnet: Use Uniswap Gateway API
          const ticks = await fetchUniswapGatewayTicks(apiId)
          if (ticks !== null) {
            return ticks
          }
          // If Gateway fails, throw to surface the error
          throw new Error('Uniswap Gateway failed to return tick data')
        } else {
          // Testnet: Use subgraph
          const ticks = await fetchSubgraphTicks(apiId, limit, networkMode)
          if (ticks !== null) {
            return ticks
          }
          throw new Error('Subgraph failed to return tick data')
        }
      },
      // Only cache if we have actual data
      { shouldCache: (data: any) => Array.isArray(data) && data.length > 0 }
    )

    // Tick data is semi-static - use multi-layer caching pattern
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale')
    }
    return res.status(200).json({
      ticks: result.data,
      cached: result.isStale ? 'stale' : true,
      count: result.data.length,
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch ticks',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
