import type { NetworkMode } from '@/lib/pools-config'
import { batchQuotePrices } from '@/lib/quote-prices'
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@/lib/network-mode'

/**
 * GraphQL Resolvers
 *
 * Each resolver calls the corresponding REST endpoint internally.
 * This creates a unified GraphQL layer over our existing REST APIs.
 *
 * @see interface/packages/api/src/graphql/resolvers (Uniswap pattern)
 */

// Context type passed to all resolvers
interface Context {
  networkMode: NetworkMode
  baseUrl: string
  request: Request
}

// Helper to make internal API calls
async function fetchInternal(
  ctx: Context,
  path: string,
  options?: RequestInit
): Promise<any> {
  const url = `${ctx.baseUrl}${path}`
  const headers = new Headers(options?.headers)
  headers.set('Cookie', `alphix-network-mode=${ctx.networkMode}`)
  headers.set('Content-Type', 'application/json')

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API Error: ${response.status} - ${error}`)
  }

  return response.json()
}

// Map Chain enum to network mode
function chainToNetworkMode(chain: string): NetworkMode {
  return chain === 'BASE_SEPOLIA' ? 'testnet' : 'mainnet'
}

export const resolvers = {
  Query: {
    // Health check
    _health: () => 'ok',

    // Token queries
    tokenPrices: async (_: unknown, args: { chain: string }, ctx: Context) => {
      // Use network-specific symbols based on context
      const isMainnet = ctx.networkMode === 'mainnet'
      const chainId = isMainnet ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID

      // Only query tokens that exist on the current network
      const symbols = isMainnet
        ? ['BTC', 'ETH', 'USDC', 'USDT']
        : ['aBTC', 'aETH', 'aUSDC', 'aUSDT']

      const prices = await batchQuotePrices(symbols, chainId, ctx.networkMode)
      const timestamp = Math.floor(Date.now() / 1000)

      // Return prices with fallbacks for cross-network compatibility
      return {
        BTC: prices['BTC'] || null,
        aBTC: prices['aBTC'] || prices['BTC'] || null,
        ETH: prices['ETH'] || null,
        aETH: prices['aETH'] || prices['ETH'] || null,
        USDC: prices['USDC'] || 1,
        aUSDC: prices['aUSDC'] || 1,
        USDT: prices['USDT'] || 1,
        aUSDT: prices['aUSDT'] || 1,
        timestamp,
      }
    },

    token: async (
      _: unknown,
      args: { chain: string; address: string },
      ctx: Context
    ) => {
      // Token data - minimal implementation
      return {
        id: `${args.chain}:${args.address}`,
        chain: args.chain,
        address: args.address,
        symbol: args.address,
        decimals: 18,
        priceUSD: null,
      }
    },

    // Pool queries
    pool: async (
      _: unknown,
      args: { chain: string; poolId: string },
      ctx: Context
    ) => {
      // Fetch pool state
      const state = await fetchInternal(
        ctx,
        `/api/liquidity/get-pool-state?poolId=${encodeURIComponent(args.poolId)}`
      )

      return {
        id: `${args.chain}:${args.poolId}`,
        chain: args.chain,
        poolId: args.poolId,
        protocolVersion: 'V4',
        sqrtPriceX96: state.sqrtPriceX96,
        tick: state.tick,
        liquidity: state.liquidity,
        currentPrice: state.currentPrice,
        protocolFee: state.protocolFee,
        lpFee: state.lpFee,
        // Token data would come from pool config
        token0: null,
        token1: null,
        feeTier: null,
        tickSpacing: null,
        hook: null,
        tvlUSD: null,
        volume24hUSD: null,
        fees24hUSD: null,
        dynamicFeeBps: null,
        apr: null,
      }
    },

    pools: async (
      _: unknown,
      args: { chain: string; first?: number; skip?: number },
      ctx: Context
    ) => {
      // This would need a pools list endpoint
      // For now return empty array
      return []
    },

    poolState: async (
      _: unknown,
      args: { chain: string; poolId: string },
      ctx: Context
    ) => {
      const data = await fetchInternal(
        ctx,
        `/api/liquidity/get-pool-state?poolId=${encodeURIComponent(args.poolId)}`
      )

      return {
        chain: args.chain,
        poolId: data.poolId,
        sqrtPriceX96: data.sqrtPriceX96,
        tick: data.tick,
        liquidity: data.liquidity,
        protocolFee: data.protocolFee,
        lpFee: data.lpFee,
        currentPrice: data.currentPrice,
        currentPoolTick: data.currentPoolTick,
      }
    },

    poolMetrics: async (
      _: unknown,
      args: { chain: string; poolId: string },
      ctx: Context
    ) => {
      const data = await fetchInternal(
        ctx,
        `/api/liquidity/pool-metrics?poolId=${encodeURIComponent(args.poolId)}`
      )

      // Extract metrics for the specific pool
      const pool = data.pools?.find(
        (p: any) => p.poolId.toLowerCase() === args.poolId.toLowerCase()
      )

      if (!pool) {
        return {
          poolId: args.poolId,
          tvlUSD: 0,
          volume24hUSD: 0,
          fees24hUSD: 0,
          dynamicFeeBps: 0,
          apr: 0,
        }
      }

      return {
        poolId: pool.poolId,
        tvlUSD: pool.tvlUSD,
        volume24hUSD: pool.volume24hUSD,
        fees24hUSD: pool.fees24hUSD,
        dynamicFeeBps: pool.dynamicFeeBps,
        apr: pool.apr,
      }
    },

    poolPriceHistory: async (
      _: unknown,
      args: { chain: string; poolId: string; duration: string },
      ctx: Context
    ) => {
      const data = await fetchInternal(
        ctx,
        `/api/liquidity/pool-price-history?poolId=${encodeURIComponent(args.poolId)}&duration=${args.duration}`
      )

      // Transform to TimestampedPoolPrice format
      if (!data.data || !Array.isArray(data.data)) {
        return []
      }

      return data.data.map((point: any, index: number) => ({
        id: `${args.poolId}:${point.timestamp || index}`,
        timestamp: point.timestamp,
        token0Price: point.token0Price || point.price,
        token1Price: point.token1Price || 1 / (point.price || 1),
      }))
    },

    poolTicks: async (
      _: unknown,
      args: { chain: string; poolId: string; skip?: number; first?: number },
      ctx: Context
    ) => {
      const data = await fetchInternal(
        ctx,
        `/api/liquidity/get-ticks?poolId=${encodeURIComponent(args.poolId)}`
      )

      if (!data.ticks || !Array.isArray(data.ticks)) {
        return []
      }

      // Apply pagination
      let ticks = data.ticks
      if (args.skip) {
        ticks = ticks.slice(args.skip)
      }
      if (args.first) {
        ticks = ticks.slice(0, args.first)
      }

      return ticks.map((tick: any) => ({
        id: `${args.poolId}:${tick.tickIdx}`,
        tickIdx: tick.tickIdx,
        liquidityGross: tick.liquidityGross,
        liquidityNet: tick.liquidityNet,
        price0: tick.price0,
        price1: tick.price1,
      }))
    },

    // Position queries
    position: async (
      _: unknown,
      args: { chain: string; positionId: string },
      ctx: Context
    ) => {
      // Would need a single position endpoint
      // For now return null
      return null
    },

    userPositions: async (
      _: unknown,
      args: { chain: string; owner: string },
      ctx: Context
    ) => {
      const data = await fetchInternal(
        ctx,
        `/api/liquidity/get-positions?ownerAddress=${encodeURIComponent(args.owner)}`
      )

      if (!Array.isArray(data)) {
        return []
      }

      return data.map((pos: any) => ({
        id: `${args.chain}:${pos.positionId}`,
        chain: args.chain,
        positionId: pos.positionId,
        owner: pos.owner,
        poolId: pos.poolId,
        pool: null, // Would need to resolve pool data
        token0: {
          address: pos.token0.address,
          symbol: pos.token0.symbol,
          amount: pos.token0.amount,
          rawAmount: pos.token0.rawAmount,
        },
        token1: {
          address: pos.token1.address,
          symbol: pos.token1.symbol,
          amount: pos.token1.amount,
          rawAmount: pos.token1.rawAmount,
        },
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        liquidity: pos.liquidityRaw,
        ageSeconds: pos.ageSeconds,
        blockTimestamp: pos.blockTimestamp,
        lastTimestamp: pos.lastTimestamp,
        isInRange: pos.isInRange,
        token0UncollectedFees: pos.token0UncollectedFees,
        token1UncollectedFees: pos.token1UncollectedFees,
        valueUSD: null,
        feesUSD: null,
      }))
    },

    positionFees: async (
      _: unknown,
      args: { chain: string; positionId: string },
      ctx: Context
    ) => {
      // Fees are already included in positions response
      // This would be for fetching fees separately
      return null
    },
  },

  Mutation: {},

  // Field resolvers for nested types
  Pool: {
    priceHistory: async (
      parent: any,
      args: { duration: string },
      ctx: Context
    ) => {
      if (!parent.poolId) return []

      const data = await fetchInternal(
        ctx,
        `/api/liquidity/pool-price-history?poolId=${encodeURIComponent(parent.poolId)}&duration=${args.duration}`
      )

      if (!data.data || !Array.isArray(data.data)) {
        return []
      }

      return data.data.map((point: any, index: number) => ({
        id: `${parent.poolId}:${point.timestamp || index}`,
        timestamp: point.timestamp,
        token0Price: point.token0Price || point.price,
        token1Price: point.token1Price || 1 / (point.price || 1),
      }))
    },

    ticks: async (
      parent: any,
      args: { skip?: number; first?: number },
      ctx: Context
    ) => {
      if (!parent.poolId) return []

      const data = await fetchInternal(
        ctx,
        `/api/liquidity/get-ticks?poolId=${encodeURIComponent(parent.poolId)}`
      )

      if (!data.ticks || !Array.isArray(data.ticks)) {
        return []
      }

      let ticks = data.ticks
      if (args.skip) {
        ticks = ticks.slice(args.skip)
      }
      if (args.first) {
        ticks = ticks.slice(0, args.first)
      }

      return ticks.map((tick: any) => ({
        id: `${parent.poolId}:${tick.tickIdx}`,
        tickIdx: tick.tickIdx,
        liquidityGross: tick.liquidityGross,
        liquidityNet: tick.liquidityNet,
        price0: tick.price0,
        price1: tick.price1,
      }))
    },
  },

  Position: {
    pool: async (parent: any, _: unknown, ctx: Context) => {
      if (!parent.poolId) return null

      try {
        const state = await fetchInternal(
          ctx,
          `/api/liquidity/get-pool-state?poolId=${encodeURIComponent(parent.poolId)}`
        )

        return {
          id: `${parent.chain}:${parent.poolId}`,
          chain: parent.chain,
          poolId: parent.poolId,
          protocolVersion: 'V4',
          sqrtPriceX96: state.sqrtPriceX96,
          tick: state.tick,
          liquidity: state.liquidity,
          currentPrice: state.currentPrice,
          token0: null,
          token1: null,
        }
      } catch {
        return null
      }
    },
  },
}
