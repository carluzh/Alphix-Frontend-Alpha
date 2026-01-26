"use client"

/**
 * Position Yield Chart - Mini chart for Unified Yield position cards
 * Shows the total APR over time, similar to PositionRangeChart but for yield data
 */

import { useEffect, useRef, useMemo, useState } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineType,
  CrosshairMode,
  UTCTimestamp,
} from 'lightweight-charts'
import { cn } from '@/lib/utils'
import { useUnifiedYieldChartData, type ChartPeriod } from '@/app/(app)/liquidity/position/[tokenId]/hooks'
import type { YieldSource } from '@/lib/pools-config'

// Chart dimensions - matches PositionRangeChart
export const CHART_HEIGHT = 48
export const CHART_WIDTH = 280

// Colors
const COLORS = {
  yieldLine: '#22c55e',    // Green for yield (always "earning")
  yieldDot: '#22c55e',     // Green dot
}

interface PositionYieldChartProps {
  /** Pool ID for data fetching */
  poolId: string
  /** Token0 symbol */
  token0Symbol: string
  /** Token1 symbol */
  token1Symbol: string
  /** Yield sources from pool config */
  yieldSources?: YieldSource[]
  /** Chart width */
  width?: number | string
  /** Chart height */
  height?: number
  /** Additional class name */
  className?: string
}

export function PositionYieldChart({
  poolId,
  token0Symbol,
  token1Symbol,
  yieldSources = [],
  width = '100%',
  height = CHART_HEIGHT,
  className,
}: PositionYieldChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  const [dotCoords, setDotCoords] = useState<{ x: number; y: number } | null>(null)
  const [isChartReady, setIsChartReady] = useState(false)

  // Fetch yield data - use 1M period for mini chart (same as PositionRangeChart)
  const { data: yieldData, isLoading } = useUnifiedYieldChartData({
    poolId,
    period: '1M' as ChartPeriod,
    yieldSources,
    token0Symbol,
    token1Symbol,
    enabled: !!poolId,
  })

  // Transform yield data to chart format
  const chartEntries = useMemo(() => {
    if (!yieldData || yieldData.length === 0) return []
    return yieldData.map(point => ({
      time: point.timestamp as UTCTimestamp,
      value: point.totalApr,
    }))
  }, [yieldData])

  const hasData = chartEntries.length > 0

  // Create chart on mount
  useEffect(() => {
    if (!chartContainerRef.current) return

    const containerWidth = chartContainerRef.current.clientWidth || 200
    const containerHeight = typeof height === 'number' ? height : CHART_HEIGHT

    const chart = createChart(chartContainerRef.current, {
      width: containerWidth,
      height: containerHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: 'transparent',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: CrosshairMode.Hidden,
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      rightPriceScale: { visible: false, autoScale: true },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScale: false,
      handleScroll: false,
    })

    chartRef.current = chart

    // Main yield series
    const series = chart.addAreaSeries({
      lineWidth: 2,
      lineType: LineType.Curved,
      lineColor: COLORS.yieldLine,
      topColor: 'rgba(34, 197, 94, 0.1)',
      bottomColor: 'transparent',
      crosshairMarkerRadius: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    seriesRef.current = series

    const handleResize = () => {
      if (chartContainerRef.current && chartContainerRef.current.clientWidth > 0) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
        chart.timeScale().fitContent()
      }
    }
    window.addEventListener('resize', handleResize)

    requestAnimationFrame(() => {
      handleResize()
    })

    setIsChartReady(true)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      setIsChartReady(false)
    }
  }, [height])

  // Update chart data
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return
    if (!hasData) return

    const series = seriesRef.current
    const chart = chartRef.current

    series.setData(chartEntries)
    series.applyOptions({
      lineType: chartEntries.length < 20 ? LineType.WithSteps : LineType.Curved,
    })

    chart.timeScale().fitContent()

    // Calculate dot position at last data point
    if (chartEntries.length > 0) {
      requestAnimationFrame(() => {
        const lastPoint = chartEntries[chartEntries.length - 1]
        const xCoord = chart.timeScale().timeToCoordinate(lastPoint.time)
        const yCoord = series.priceToCoordinate(lastPoint.value)
        if (xCoord !== null && yCoord !== null) {
          setDotCoords({ x: Number(xCoord), y: Number(yCoord) })
        }
      })
    }
  }, [chartEntries, hasData])

  const shouldRenderDot = isChartReady && hasData && dotCoords && dotCoords.y > 3
  const showLoading = isLoading
  const showNoData = !isLoading && !hasData

  const chartHeight = typeof height === 'number' ? height : CHART_HEIGHT

  return (
    <div className={cn('relative', className)} style={{ width, height: chartHeight, minHeight: chartHeight }}>
      {/* Chart container */}
      <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />

      {/* Loading overlay */}
      {showLoading && (
        <div className="absolute inset-0 bg-muted/20 rounded animate-pulse" />
      )}

      {/* No data overlay */}
      {showNoData && (
        <div className="absolute inset-0 bg-muted/10 rounded flex items-center justify-center">
          <span className="text-xs text-muted-foreground">No data</span>
        </div>
      )}

      {/* Status indicator dot at current yield */}
      {shouldRenderDot && (
        <svg
          className="absolute pointer-events-none"
          style={{
            left: dotCoords.x - 4,
            top: dotCoords.y - 4,
          }}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
        >
          {/* Outer circle - 40% opacity */}
          <circle cx="4" cy="4" r="4" fill={COLORS.yieldDot} fillOpacity="0.4" />
          {/* Inner circle - solid */}
          <circle cx="4" cy="4" r="2" fill={COLORS.yieldDot} />
        </svg>
      )}
    </div>
  )
}

export function PositionYieldChartLoader({
  width = '100%',
  height = CHART_HEIGHT,
  className,
}: {
  width?: number | string
  height?: number
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-center', className)} style={{ width, height }}>
      <div className="h-full w-full bg-muted/20 rounded animate-pulse" />
    </div>
  )
}

export default PositionYieldChart
