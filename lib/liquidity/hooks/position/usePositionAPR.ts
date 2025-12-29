/**
 * usePositionAPR Hook
 * Calculates APR for liquidity positions using consolidated apr.ts
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Percent } from '@uniswap/sdk-core'
import { Token } from '@uniswap/sdk-core'
import { Pool as V4PoolSDK } from '@uniswap/v4-sdk'
import JSBI from 'jsbi'
import { getAddress } from 'viem'
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from '@/lib/swap-constants'
import { getPoolById, getTokenDefinitions, TokenSymbol, NetworkMode } from '@/lib/pools-config'
import { calculatePositionApr, formatAprValue, type PoolMetrics } from '@/lib/apr'
import { type CalculatedLiquidityData } from '../transaction/useAddLiquidityCalculation'

export interface CachedPoolMetrics {
  poolId: string
  metrics: PoolMetrics | null
  poolLiquidity: string
}

export interface UsePositionAPRParams {
  selectedPoolId?: string
  tickLower: string
  tickUpper: string
  currentPoolTick: number | null
  currentPoolSqrtPriceX96: string | null
  token0Symbol: TokenSymbol
  token1Symbol: TokenSymbol
  amount0: string
  amount1: string
  calculatedData: CalculatedLiquidityData | null
  poolLiquidity?: string
  chainId: number
  networkMode: NetworkMode
}

export interface UsePositionAPRResult {
  estimatedApr: string
  apr: Percent | null
  isCalculatingApr: boolean
  cachedPoolMetrics: CachedPoolMetrics | null
}

export function usePositionAPR(params: UsePositionAPRParams): UsePositionAPRResult {
  const {
    selectedPoolId,
    tickLower,
    tickUpper,
    currentPoolTick,
    currentPoolSqrtPriceX96,
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    calculatedData,
    poolLiquidity,
    chainId,
    networkMode,
  } = params

  const [apr, setApr] = useState<Percent | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [cachedPoolMetrics, setCachedPoolMetrics] = useState<CachedPoolMetrics | null>(null)
  const fetchedPoolRef = useRef<string | null>(null)
  const tokenDefinitions = getTokenDefinitions(networkMode)

  const lowerTick = parseInt(tickLower)
  const upperTick = parseInt(tickUpper)

  const hasValidInputs = !!(
    selectedPoolId &&
    tickLower &&
    tickUpper &&
    currentPoolSqrtPriceX96 &&
    currentPoolTick !== null &&
    poolLiquidity &&
    !isNaN(lowerTick) &&
    !isNaN(upperTick) &&
    lowerTick < upperTick
  )

  const hasMetrics = cachedPoolMetrics?.poolId === selectedPoolId && !!cachedPoolMetrics?.metrics?.days

  // Fetch pool metrics
  useEffect(() => {
    if (!selectedPoolId || !poolLiquidity || fetchedPoolRef.current === selectedPoolId) return
    fetchedPoolRef.current = selectedPoolId

    fetch('/api/liquidity/pool-metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poolId: selectedPoolId, days: 7 }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.metrics) {
          setCachedPoolMetrics({ poolId: selectedPoolId, metrics: data.metrics, poolLiquidity })
        }
      })
      .catch(() => { fetchedPoolRef.current = null })
  }, [selectedPoolId, poolLiquidity])

  // Calculate APR
  useEffect(() => {
    if (!hasValidInputs || !hasMetrics) {
      setApr(null)
      setIsCalculating(false)
      return
    }

    setIsCalculating(true)

    const timer = setTimeout(async () => {
      try {
        const poolConfig = getPoolById(selectedPoolId!)
        const token0Def = tokenDefinitions[token0Symbol]
        const token1Def = tokenDefinitions[token1Symbol]

        if (!poolConfig || !token0Def || !token1Def) {
          setApr(null)
          return
        }

        const sdkPool = new V4PoolSDK(
          new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Symbol, token0Symbol),
          new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Symbol, token1Symbol),
          V4_POOL_FEE,
          V4_POOL_TICK_SPACING,
          V4_POOL_HOOKS,
          JSBI.BigInt(currentPoolSqrtPriceX96!),
          JSBI.BigInt(cachedPoolMetrics!.poolLiquidity),
          currentPoolTick!
        )

        const hasUserAmounts = parseFloat(amount0 || '0') > 0 || parseFloat(amount1 || '0') > 0
        const userAmounts = hasUserAmounts
          ? { amount0, amount1, liquidity: calculatedData?.liquidity }
          : undefined

        const result = await calculatePositionApr(
          sdkPool,
          lowerTick,
          upperTick,
          cachedPoolMetrics!.metrics!,
          100,
          userAmounts
        )

        setApr(result)
      } catch {
        setApr(null)
      } finally {
        setIsCalculating(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [
    hasValidInputs,
    hasMetrics,
    selectedPoolId,
    lowerTick,
    upperTick,
    currentPoolSqrtPriceX96,
    currentPoolTick,
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    calculatedData,
    cachedPoolMetrics,
    chainId,
    tokenDefinitions,
  ])

  const isCalculatingApr = isCalculating || (hasValidInputs && !hasMetrics)

  return {
    estimatedApr: formatAprValue(apr),
    apr,
    isCalculatingApr,
    cachedPoolMetrics,
  }
}

// Re-export types for backwards compatibility
export type { PoolMetrics } from '@/lib/apr'
