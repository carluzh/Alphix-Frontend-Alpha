import { useCallback, useEffect, useRef, useState } from "react"
import type { TokenSymbol } from "@/lib/pools-config"
import type { SwapRoute } from "@/lib/routing-engine"
import { findBestRoute } from "@/lib/routing-engine"

type RouteInfo = {
  path: string[]
  hops: number
  isDirectRoute: boolean
  pools: string[]
} | null

type RouteFee = { poolName: string; fee: number }

type Args = {
  fromToken: { address: string } | null
  toToken: { address: string } | null
  tokenDefinitions: Record<string, { address: string }>
  targetChainId: number
  isConnected: boolean
  currentChainId?: number
  currentRoute: SwapRoute | null
  setCurrentRoute: (r: SwapRoute | null) => void
  setSelectedPoolIndexForChart: (n: number) => void
}

export function useSwapRoutingFees({
  fromToken,
  toToken,
  tokenDefinitions,
  targetChainId,
  isConnected,
  currentChainId,
  currentRoute,
  setCurrentRoute,
  setSelectedPoolIndexForChart,
}: Args) {
  const [routeInfo, setRouteInfo] = useState<RouteInfo>(null)
  const [routeFees, setRouteFees] = useState<RouteFee[]>([])
  const [routeFeesLoading, setRouteFeesLoading] = useState(false)
  const [dynamicFeeBps, setDynamicFeeBps] = useState<number | null>(null)
  const [dynamicFeeLoading, setDynamicFeeLoading] = useState(false)
  const [dynamicFeeError, setDynamicFeeError] = useState<string | null>(null)
  const isFetchingDynamicFeeRef = useRef(false)

  const calculateRoute = useCallback(
    async (fromTokenSymbol: string, toTokenSymbol: string) => {
      try {
        const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol)
        if (!routeResult.bestRoute) return null
        const route = routeResult.bestRoute

        if (JSON.stringify(route) !== JSON.stringify(currentRoute)) {
          setCurrentRoute(route)
          setSelectedPoolIndexForChart(0)
        }

        setRouteInfo({
          path: route.path,
          hops: route.hops,
          isDirectRoute: route.isDirectRoute,
          pools: route.pools.map((pool) => pool.poolName),
        })

        return route
      } catch (error) {
        console.error("[useSwapRoutingFees] Error calculating route:", error)
        return null
      }
    },
    [currentRoute, setCurrentRoute, setSelectedPoolIndexForChart]
  )

  const fetchRouteFees = useCallback(
    async (route: SwapRoute): Promise<RouteFee[]> => {
      if (!route || route.pools.length === 0) {
        setRouteFees([])
        return []
      }

      setRouteFeesLoading(true)
      const fees: RouteFee[] = []

      try {
        for (const pool of route.pools) {
          const response = await fetch("/api/swap/get-dynamic-fee", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fromTokenSymbol: pool.token0,
              toTokenSymbol: pool.token1,
              chainId: targetChainId,
            }),
          })

          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.message || data.errorDetails || `Failed to fetch dynamic fee for ${pool.poolName}`)
          }

          const poolFee = Number(data.dynamicFee)
          if (isNaN(poolFee)) throw new Error(`Dynamic fee received is not a number for ${pool.poolName}: ${data.dynamicFee}`)
          fees.push({ poolName: pool.poolName, fee: poolFee })
        }

        setRouteFees(fees)
        return fees
      } catch (error) {
        console.error("[useSwapRoutingFees] Error fetching route fees:", error)
        setRouteFees([])
        return []
      } finally {
        setRouteFeesLoading(false)
      }
    },
    [targetChainId]
  )

  const fetchFee = useCallback(async () => {
    if (!fromToken || !toToken) {
      setDynamicFeeBps(null)
      setDynamicFeeLoading(false)
      setDynamicFeeError(null)
      setCurrentRoute(null)
      setRouteFees([])
      setRouteFeesLoading(false)
      setRouteInfo(null)
      return
    }

    const fromTokenSymbolForCache = Object.keys(tokenDefinitions).find(
      (key) => tokenDefinitions[key as TokenSymbol].address === fromToken.address
    ) as TokenSymbol | undefined
    const toTokenSymbolForCache = Object.keys(tokenDefinitions).find(
      (key) => tokenDefinitions[key as TokenSymbol].address === toToken.address
    ) as TokenSymbol | undefined

    if (!fromTokenSymbolForCache || !toTokenSymbolForCache) {
      console.error("[useSwapRoutingFees] Could not determine token symbols for cache key.")
      setDynamicFeeError("Token configuration error for fee.")
      setDynamicFeeLoading(false)
      setRouteFeesLoading(false)
      return
    }

    if (isFetchingDynamicFeeRef.current) return
    isFetchingDynamicFeeRef.current = true

    setDynamicFeeLoading(true)
    setRouteFeesLoading(true)
    setDynamicFeeError(null)

    try {
      const route = await calculateRoute(fromTokenSymbolForCache, toTokenSymbolForCache)
      if (!route) throw new Error(`No route found for token pair ${fromTokenSymbolForCache}/${toTokenSymbolForCache}`)

      const fees = await fetchRouteFees(route)
      setDynamicFeeBps(fees.length > 0 ? fees[0].fee : null)
      setDynamicFeeLoading(false)
      setRouteFeesLoading(false)
    } catch (error: any) {
      console.error("[useSwapRoutingFees] Error fetching dynamic fee:", error.message)
      setDynamicFeeBps(null)
      setCurrentRoute(null)
      setRouteFees([])
      setDynamicFeeLoading(false)
      setRouteFeesLoading(false)
      setDynamicFeeError(error.message || "Error fetching fee.")
    } finally {
      isFetchingDynamicFeeRef.current = false
    }
  }, [fromToken?.address, toToken?.address, tokenDefinitions, calculateRoute, fetchRouteFees, setCurrentRoute])

  useEffect(() => {
    fetchFee()
    return () => {
      isFetchingDynamicFeeRef.current = false
    }
  }, [fetchFee])

  // preserve old "no-op effect" behavior
  useEffect(() => {
    if (!isConnected || currentChainId !== targetChainId || !fromToken || !toToken) return
  }, [isConnected, currentChainId, fromToken?.address, toToken?.address, targetChainId])

  return {
    routeInfo,
    setRouteInfo,
    routeFees,
    routeFeesLoading,
    dynamicFeeBps,
    dynamicFeeLoading,
    dynamicFeeError,
  }
}


