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

type Args = {
  fromToken: { address: string } | null
  toToken: { address: string } | null
  tokenDefinitions: Record<string, { address: string }>
  currentRoute: SwapRoute | null
  setCurrentRoute: (r: SwapRoute | null) => void
  setSelectedPoolIndexForChart: (n: number) => void
}

export function useSwapRoutingFees({
  fromToken,
  toToken,
  tokenDefinitions,
  currentRoute,
  setCurrentRoute,
  setSelectedPoolIndexForChart,
}: Args) {
  const [routeInfo, setRouteInfo] = useState<RouteInfo>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const isCalculatingRef = useRef(false)

  const calculateRoute = useCallback(async () => {
    if (!fromToken || !toToken) {
      setCurrentRoute(null)
      setRouteInfo(null)
      setRouteError(null)
      return
    }

    const fromTokenSymbol = Object.keys(tokenDefinitions).find(
      (key) => tokenDefinitions[key as TokenSymbol].address === fromToken.address
    ) as TokenSymbol | undefined
    const toTokenSymbol = Object.keys(tokenDefinitions).find(
      (key) => tokenDefinitions[key as TokenSymbol].address === toToken.address
    ) as TokenSymbol | undefined

    if (!fromTokenSymbol || !toTokenSymbol) {
      setRouteError("Token configuration error")
      return
    }

    if (isCalculatingRef.current) return
    isCalculatingRef.current = true

    try {
      const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol)
      if (!routeResult.bestRoute) {
        setRouteError(`No route found for ${fromTokenSymbol}/${toTokenSymbol}`)
        setCurrentRoute(null)
        setRouteInfo(null)
        return
      }

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
      setRouteError(null)
    } catch (error: any) {
      console.error("[useSwapRoutingFees] Error calculating route:", error)
      setRouteError(error.message || "Error calculating route")
      setCurrentRoute(null)
      setRouteInfo(null)
    } finally {
      isCalculatingRef.current = false
    }
  }, [fromToken?.address, toToken?.address, tokenDefinitions, currentRoute, setCurrentRoute, setSelectedPoolIndexForChart])

  useEffect(() => {
    calculateRoute()
    return () => {
      isCalculatingRef.current = false
    }
  }, [calculateRoute])

  return {
    routeInfo,
    setRouteInfo,
    routeError,
  }
}


