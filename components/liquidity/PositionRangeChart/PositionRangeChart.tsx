"use client"

/**
 * Position Range Chart - Lightweight-charts based mini chart for position cards
 * Adapted from Uniswap's LiquidityPositionRangeChart
 * @see interface/apps/web/src/components/Charts/LiquidityPositionRangeChart/LiquidityPositionRangeChart.tsx
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
import { PositionStatus } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { cn } from '@/lib/utils'
import { usePoolPriceChartData, HistoryDuration, DataQuality, type PriceChartData } from '@/lib/chart'
import { BandsIndicator } from '@/lib/chart/BandsIndicator/bands-indicator'
import { cloneReadonly } from '@/lib/chart/BandsIndicator/helpers/simple-clone'

// Chart dimensions - slightly larger than Uniswap default
export const CHART_HEIGHT = 48
export const CHART_WIDTH = 280

// Colors - matching Uniswap's color scheme
const COLORS = {
  inRange: '#22c55e',      // Green for in-range (statusSuccess)
  outOfRange: '#ef4444',   // Red for out-of-range (statusCritical)
  neutral: '#9B9B9B',      // Gray for closed/unknown (neutral2)
  bandLine: 'rgba(255, 255, 255, 0.10)',  // neutral1 with opacity
  bandFill: 'rgba(255, 255, 255, 0.04)',  // surface3 - neutral, not status-colored
}

/**
 * Get price line color based on position status
 */
function getPriceLineColor(status?: PositionStatus): string {
  switch (status) {
    case PositionStatus.IN_RANGE:
      return COLORS.inRange
    case PositionStatus.OUT_OF_RANGE:
      return COLORS.outOfRange
    case PositionStatus.CLOSED:
    default:
      return COLORS.neutral
  }
}

/**
 * Generate extended data for range band visualization
 * Extends the time series to make the band fill the chart width
 * @see LPPriceChartModel.generateExtendedData
 */
function generateExtendedData(data: PriceChartData[]): PriceChartData[] {
  if (data.length === 0) return data
  const lastTime = data[data.length - 1]?.time
  if (!lastTime) return data

  const timeDelta = lastTime - data[0]?.time
  const timeIncrement = timeDelta / data.length
  if (timeIncrement === 0) return data

  const newData = cloneReadonly(data)
  const lastData = newData[newData.length - 1]

  // Add extra data points to extend the time scale
  for (let i = 1; i <= Math.floor(data.length / 10); i++) {
    const time = lastTime + timeIncrement * i
    newData.push({
      ...lastData,
      time: time as UTCTimestamp,
    })
  }
  return newData
}

interface PositionRangeChartProps {
  /** Pool ID for data fetching */
  poolId: string
  /** Token0 symbol */
  token0: string
  /** Token1 symbol */
  token1: string
  /** Whether prices are inverted (controlled by parent's toggle) */
  priceInverted: boolean
  /** Position status (IN_RANGE, OUT_OF_RANGE, CLOSED) */
  positionStatus?: PositionStatus
  /** Lower price bound (numeric, already in display denomination) */
  priceLower?: number
  /** Upper price bound (numeric, already in display denomination) */
  priceUpper?: number
  /** Chart width */
  width?: number | string
  /** Chart height */
  height?: number
  /** Additional class name */
  className?: string
}

export function PositionRangeChart({
  poolId,
  token0,
  token1,
  priceInverted,
  positionStatus,
  priceLower,
  priceUpper,
  width = '100%',
  height = CHART_HEIGHT,
  className,
}: PositionRangeChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const bandSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bandIndicatorRef = useRef<BandsIndicator | null>(null)

  const [dotCoords, setDotCoords] = useState<{ x: number; y: number } | null>(null)
  const [isChartReady, setIsChartReady] = useState(false)

  // Fetch price data - use MONTH duration like Uniswap
  // @see interface/apps/web/src/components/Charts/LiquidityPositionRangeChart/LiquidityPositionRangeChart.tsx:484
  const { entries, loading, dataQuality } = usePoolPriceChartData({
    variables: {
      poolId,
      token0,
      token1,
      duration: HistoryDuration.MONTH,
    },
    priceInverted,
  })

  const hasError = dataQuality === DataQuality.INVALID
  const hasData = entries.length > 0

  // Chart color based on position status
  const lineColor = getPriceLineColor(positionStatus)

  // Extended data for band series
  const extendedData = useMemo(() => generateExtendedData(entries), [entries])

  // Create chart on mount
  useEffect(() => {
    if (!chartContainerRef.current) return

    // Get container dimensions - use fallback if not yet laid out
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

    // Main price series - set initial line color based on status
    const initialLineColor = getPriceLineColor(positionStatus)
    const series = chart.addAreaSeries({
      lineWidth: 2,
      lineType: LineType.Curved,
      lineColor: initialLineColor,
      topColor: 'transparent',
      bottomColor: 'transparent',
      crosshairMarkerRadius: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    seriesRef.current = series

    // Band series (invisible line, just for primitive attachment)
    const bandSeries = chart.addLineSeries({
      priceScaleId: 'right',
      priceLineVisible: false,
      color: 'transparent',
    })
    bandSeriesRef.current = bandSeries

    const handleResize = () => {
      if (chartContainerRef.current && chartContainerRef.current.clientWidth > 0) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
        chart.timeScale().fitContent()
      }
    }
    window.addEventListener('resize', handleResize)

    // Trigger initial resize after a brief delay to ensure container has dimensions
    requestAnimationFrame(() => {
      handleResize()
    })

    setIsChartReady(true)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      bandSeriesRef.current = null
      bandIndicatorRef.current = null
      setIsChartReady(false)
    }
  }, [height])

  // Update chart data and styling
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || !bandSeriesRef.current) return
    if (!hasData) return

    const series = seriesRef.current
    const bandSeries = bandSeriesRef.current
    const chart = chartRef.current

    // Set main series data and style
    series.setData(entries)
    series.applyOptions({
      lineColor,
      lineType: entries.length < 20 ? LineType.WithSteps : LineType.Curved,
      priceLineVisible: false,
    })

    // Set band series data (extended)
    bandSeries.setData(extendedData)

    // Set up or update band indicator
    if (priceLower !== undefined && priceUpper !== undefined && priceLower > 0 && priceUpper < Number.MAX_SAFE_INTEGER) {
      if (!bandIndicatorRef.current) {
        bandIndicatorRef.current = new BandsIndicator({
          lineColor: COLORS.bandLine,
          fillColor: COLORS.bandFill,
          lineWidth: 1,
          upperValue: priceUpper,
          lowerValue: priceLower,
        })
        bandSeries.attachPrimitive(bandIndicatorRef.current)
      } else {
        bandIndicatorRef.current.updateOptions({
          lineColor: COLORS.bandLine,
          fillColor: COLORS.bandFill,
          lineWidth: 1,
          upperValue: priceUpper,
          lowerValue: priceLower,
        })
        bandIndicatorRef.current.updateAllViews()
      }
    }

    chart.timeScale().fitContent()

    // Calculate dot position at last data point
    if (entries.length > 0) {
      requestAnimationFrame(() => {
        const lastPoint = entries[entries.length - 1]
        const xCoord = chart.timeScale().timeToCoordinate(lastPoint.time)
        const yCoord = series.priceToCoordinate(lastPoint.value)
        if (xCoord !== null && yCoord !== null) {
          setDotCoords({ x: Number(xCoord), y: Number(yCoord) })
        }
      })
    }
  }, [entries, extendedData, lineColor, priceLower, priceUpper, hasData])

  const shouldRenderDot = isChartReady && hasData && dotCoords && dotCoords.y > 3
  const showLoading = loading
  const showNoData = !loading && (hasError || !hasData)

  // Ensure numeric height for chart
  const chartHeight = typeof height === 'number' ? height : CHART_HEIGHT

  return (
    <div className={cn('relative', className)} style={{ width, height: chartHeight, minHeight: chartHeight }}>
      {/* Chart container - always rendered so ref is available */}
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

      {/* Status indicator dot at current price - matches StatusIndicatorCircle style */}
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
          <circle cx="4" cy="4" r="4" fill={lineColor} fillOpacity="0.4" />
          {/* Inner circle - solid */}
          <circle cx="4" cy="4" r="2" fill={lineColor} />
        </svg>
      )}
    </div>
  )
}

/**
 * Loader component for position range chart
 */
export function PositionRangeChartLoader({
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

export default PositionRangeChart
