import { useEffect, useMemo, useRef, useState } from "react"
import { getPoolByTokens } from "@/lib/pools-config"
import type { NetworkMode } from "@/lib/network-mode"
import type { SwapRoute } from "@/lib/swap/routing-engine"

export type FeeHistoryPoint = {
  timeLabel: string
  volumeTvlRatio: number
  emaRatio: number
  dynamicFee: number
}

type PoolInfo = { token0Symbol: string; token1Symbol: string; poolName: string } | undefined

type Args = {
  isMounted: boolean
  isConnected: boolean
  currentRoute: SwapRoute | null
  selectedPoolIndexForChart: number
  networkMode?: NetworkMode
}

export function useFeeHistory({ isMounted, isConnected, currentRoute, selectedPoolIndexForChart, networkMode }: Args) {
  const [feeHistoryData, setFeeHistoryData] = useState<FeeHistoryPoint[]>([])
  const [isFeeHistoryLoading, setIsFeeHistoryLoading] = useState(false)
  const [feeHistoryError, setFeeHistoryError] = useState<string | null>(null)
  const isFetchingFeeHistoryRef = useRef(false)

  const poolInfo: PoolInfo = useMemo(() => {
    if (!currentRoute || currentRoute.pools.length === 0) return undefined
    const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1)
    const selectedPool = currentRoute.pools[poolIndex]
    return {
      token0Symbol: selectedPool.token0,
      token1Symbol: selectedPool.token1,
      poolName: selectedPool.poolName,
    }
  }, [currentRoute, selectedPoolIndexForChart])

  const fallbackPoolInfo: PoolInfo = useMemo(() => {
    const fallback = getPoolByTokens("atUSDC", "atDAI", networkMode)
    if (!fallback) return undefined
    return {
      token0Symbol: fallback.currency0.symbol,
      token1Symbol: fallback.currency1.symbol,
      poolName: fallback.name,
    }
  }, [networkMode])

  const feeHistoryKey = useMemo(() => {
    if (!isMounted) return null
    if (!isConnected) {
      const fallback = getPoolByTokens("atUSDC", "atDAI", networkMode)
      return fallback ? `${fallback.subgraphId}_fallback_${networkMode || 'base'}` : null
    }
    if (!currentRoute) return null
    const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1)
    const poolIdForHistory = currentRoute.pools[poolIndex]?.subgraphId
    return poolIdForHistory ? `${poolIdForHistory}_${selectedPoolIndexForChart}_${networkMode || 'base'}` : null
  }, [isMounted, isConnected, currentRoute, selectedPoolIndexForChart, networkMode])

  useEffect(() => {
    const fetchHistoricalFeeData = async () => {
      if (!feeHistoryKey) {
        setFeeHistoryData([])
        return
      }

      let poolIdForFeeHistory: string | undefined
      if (currentRoute) {
        const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1)
        poolIdForFeeHistory = currentRoute.pools[poolIndex]?.subgraphId
      } else {
        const fallback = getPoolByTokens("atUSDC", "atDAI", networkMode)
        poolIdForFeeHistory = fallback?.subgraphId
      }

      const cacheKey = `feeHistory_${poolIdForFeeHistory}_${networkMode || 'base'}_30days`

      try {
        const cachedItem = sessionStorage.getItem(cacheKey)
        if (cachedItem) {
          const cached = JSON.parse(cachedItem)
          const now = Date.now()
          // Validate cache shape: must be transformed FeeHistoryPoint[], not raw HookEvent[]
          const isValidShape = Array.isArray(cached.data) && cached.data.length > 0
            && typeof cached.data[0]?.timeLabel === 'string'
          if (cached.timestamp && now - cached.timestamp < 1800000 && isValidShape) {
            setFeeHistoryData(cached.data)
            setIsFeeHistoryLoading(false)
            setFeeHistoryError(null)
            return
          }
          sessionStorage.removeItem(cacheKey)
        }
      } catch {
        sessionStorage.removeItem(cacheKey)
      }

      if (isFetchingFeeHistoryRef.current) return
      isFetchingFeeHistoryRef.current = true
      setIsFeeHistoryLoading(true)
      setFeeHistoryError(null)

      try {
        const networkParam = networkMode ? `&network=${networkMode}` : ''
        const response = await fetch(`/api/liquidity/get-historical-dynamic-fees?poolId=${poolIdForFeeHistory}&days=30${networkParam}`)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Failed to fetch historical fee data: ${response.statusText}`)
        }
        const rawEvents: any[] = await response.json()

        if (rawEvents && rawEvents.length > 0) {
          // Transform raw HookEvent[] → FeeHistoryPoint[]
          const nowSec = Math.floor(Date.now() / 1000)
          const thirtyDaysAgoSec = nowSec - 30 * 24 * 60 * 60

          const scaleRatio = (val: any): number => {
            const n = typeof val === 'string' ? Number(val) : (typeof val === 'number' ? val : 0)
            if (!Number.isFinite(n)) return 0
            if (Math.abs(n) >= 1e12) return n / 1e18
            if (Math.abs(n) >= 1e6) return n / 1e6
            if (Math.abs(n) >= 1e4) return n / 1e4
            return n
          }

          let points: FeeHistoryPoint[] = rawEvents
            .map((e: any) => ({
              ts: Number(e?.timestamp) || 0,
              feeBps: Number(e?.newFeeBps ?? e?.newFeeRateBps ?? 0),
              ratio: e?.currentRatio,
              ema: e?.newTargetRatio,
            }))
            .filter((e: any) => e.ts >= thirtyDaysAgoSec)
            .sort((a: any, b: any) => a.ts - b.ts)
            .map((e: any) => ({
              timeLabel: new Date(e.ts * 1000).toISOString().split('T')[0],
              volumeTvlRatio: scaleRatio(e.ratio),
              emaRatio: scaleRatio(e.ema),
              dynamicFee: (Number.isFinite(e.feeBps) ? e.feeBps : 0) / 10000,
            }))

          if (points.length > 30) points = points.slice(-30)

          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ data: points, timestamp: Date.now() }))
          } catch {}
          setFeeHistoryData(points)
        } else {
          setFeeHistoryData([])
        }
      } catch (error: any) {
        console.error("Failed to fetch historical fee data:", error)
        setFeeHistoryError(error.message || "Could not load fee history.")
        setFeeHistoryData([])
      } finally {
        setIsFeeHistoryLoading(false)
        isFetchingFeeHistoryRef.current = false
      }
    }

    fetchHistoricalFeeData()
    return () => {}
  }, [feeHistoryKey, currentRoute, selectedPoolIndexForChart, networkMode])

  return {
    feeHistoryData,
    isFeeHistoryLoading,
    feeHistoryError,
    poolInfo,
    fallbackPoolInfo,
  }
}
