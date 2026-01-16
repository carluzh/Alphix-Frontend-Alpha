import { useEffect, useMemo, useRef, useState } from "react"
import { getPoolByTokens } from "@/lib/pools-config"
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
}

export function useFeeHistory({ isMounted, isConnected, currentRoute, selectedPoolIndexForChart }: Args) {
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
    const fallback = getPoolByTokens("aUSDC", "aUSDT")
    if (!fallback) return undefined
    return {
      token0Symbol: fallback.currency0.symbol,
      token1Symbol: fallback.currency1.symbol,
      poolName: fallback.name,
    }
  }, [])

  const feeHistoryKey = useMemo(() => {
    if (!isMounted) return null
    if (!isConnected) {
      const fallback = getPoolByTokens("aUSDC", "aUSDT")
      return fallback ? `${fallback.subgraphId}_fallback` : null
    }
    if (!currentRoute) return null
    const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1)
    const poolIdForHistory = currentRoute.pools[poolIndex]?.subgraphId
    return poolIdForHistory ? `${poolIdForHistory}_${selectedPoolIndexForChart}` : null
  }, [isMounted, isConnected, currentRoute, selectedPoolIndexForChart])

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
        const fallback = getPoolByTokens("aUSDC", "aUSDT")
        poolIdForFeeHistory = fallback?.subgraphId
      }

      const cacheKey = `feeHistory_${poolIdForFeeHistory}_30days`

      try {
        const cachedItem = sessionStorage.getItem(cacheKey)
        if (cachedItem) {
          const cached = JSON.parse(cachedItem)
          const now = Date.now()
          if (cached.timestamp && now - cached.timestamp < 1800000 && cached.data) {
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
        const response = await fetch(`/api/liquidity/get-historical-dynamic-fees?poolId=${poolIdForFeeHistory}&days=30`)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.message || `Failed to fetch historical fee data: ${response.statusText}`)
        }
        const data: FeeHistoryPoint[] = await response.json()

        if (data && data.length > 0) {
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }))
          } catch {}
          setFeeHistoryData(data)
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
  }, [feeHistoryKey, currentRoute, selectedPoolIndexForChart])

  return {
    feeHistoryData,
    isFeeHistoryLoading,
    feeHistoryError,
    poolInfo,
    fallbackPoolInfo,
  }
}



