"use client"

/**
 * SwapRoutePreview - Sankey flow diagram for swap route visualization.
 *
 * Single horizontal row: FROM bar on left, TO bar on right, intermediate
 * tokens stacked in middle column(s). Flow bands fan out from FROM through
 * intermediates and converge back to TO. Never multiple rows.
 */

import { useMemo, useState, useRef, useCallback, useEffect } from "react"
import Image from "next/image"
import { TokenImage } from "@/components/ui/token-image"
import {
  buildAddressSymbolMap,
  buildIconMap,
  resolveTokenIcon,
  parseSplitRoutes,
  type ParsedSplitRoute,
} from "./swapRouteHelpers"
import type { NetworkMode } from "@/lib/network-mode"
import type { KyberswapRouteSummary } from "@/lib/aggregators/types"
import type { AggregatorSource } from "@/lib/aggregators/types"
import type { Token } from "./swap-interface"
import type { RouteTokenMetadata } from "./useSwapQuote"

interface RouteInfo {
  path: string[]
  hops: number
  isDirectRoute: boolean
  pools: string[]
}

interface SwapRoutePreviewProps {
  source: AggregatorSource
  fromToken: Token
  toToken: Token
  routeInfo?: RouteInfo | null
  kyberswapRouteSummary?: KyberswapRouteSummary
  tokenMetadata?: RouteTokenMetadata
  isLoading?: boolean
  /** Compact mode for the swap wizard modal: shorter height, square nodes, no header/legend */
  compact?: boolean
  networkMode?: NetworkMode
}

const ALPHIX_FLOW_COLOR = "#9ca3af" // neutral grey for Alphix Custom Pool flows

const ROUTE_COLORS = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#ec4899", // pink
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#f97316", // orange
  "#64748b", // slate
]

// Layout
const NODE_W = 40
const NODE_H = 120
const NODE_R = 8
const ICON_SIZE = 22
const H_PAD = 0
const V_PAD = 20
const FLOW_GAP = 2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildExchangeColorMap(routes: ParsedSplitRoute[]): Map<string, string> {
  const map = new Map<string, string>()
  let idx = 0
  for (const r of routes) {
    for (const ex of r.exchanges) {
      const key = ex.toLowerCase()
      if (!map.has(key)) {
        // Alphix Custom Pool always gets the consistent Alphix flow color
        map.set(key, key === "custom pool" ? ALPHIX_FLOW_COLOR : ROUTE_COLORS[idx % ROUTE_COLORS.length])
        idx++
      }
    }
  }
  return map
}

function titleCase(s: string): string {
  return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function sankeyPath(
  x1: number, y1Top: number, y1Bot: number,
  x2: number, y2Top: number, y2Bot: number,
): string {
  const cx = (x1 + x2) / 2
  return [
    `M ${x1} ${y1Top}`,
    `C ${cx} ${y1Top}, ${cx} ${y2Top}, ${x2} ${y2Top}`,
    `L ${x2} ${y2Bot}`,
    `C ${cx} ${y2Bot}, ${cx} ${y1Bot}, ${x1} ${y1Bot}`,
    "Z",
  ].join(" ")
}

function buildColumnMapping(routes: ParsedSplitRoute[], maxCols: number) {
  const mapping = new Map<string, number>()
  for (let ri = 0; ri < routes.length; ri++) {
    const len = routes[ri].path.length
    for (let ti = 0; ti < len; ti++) {
      let col: number
      if (len === 1) col = 0
      else col = Math.round((ti / (len - 1)) * (maxCols - 1))
      mapping.set(`${ri}-${ti}`, col)
    }
  }
  return mapping
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipData {
  exchange: string
  color: string
  percentage: number
  fromSymbol: string
  toSymbol: string
  x: number
  y: number
}

interface NodeTooltipData {
  symbol: string
  x: number
  y: number
}

function FlowTooltip({ data, compact }: { data: TooltipData; compact?: boolean }) {
  if (compact) {
    return (
      <div
        className="absolute z-50 pointer-events-none rounded-md border border-sidebar-border/60 bg-container shadow-lg px-2 py-1"
        style={{ left: data.x, top: data.y, transform: "translate(-50%, -100%) translateY(-8px)" }}
      >
        <span className="text-[11px] font-medium text-foreground leading-none">{titleCase(data.exchange)}</span>
      </div>
    )
  }
  return (
    <div
      className="absolute z-50 pointer-events-none rounded-lg border border-sidebar-border/60 bg-container shadow-lg px-3 py-2 min-w-[180px]"
      style={{ left: data.x, top: data.y, transform: "translate(-50%, -100%) translateY(-8px)" }}
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded shrink-0" style={{ backgroundColor: data.color }} />
          <span className="text-xs font-medium text-foreground">{titleCase(data.exchange)}</span>
        </div>
        <span className="text-xs font-medium text-foreground">{Math.round(data.percentage)}%</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Trading Pair</span>
        <span className="text-[10px] text-muted-foreground font-medium">{data.fromSymbol}/{data.toSymbol}</span>
      </div>
    </div>
  )
}

function NodeTooltip({ data }: { data: NodeTooltipData }) {
  return (
    <div
      className="absolute z-50 pointer-events-none rounded-lg border border-sidebar-border/60 bg-container shadow-lg px-3 py-1.5"
      style={{ left: data.x, top: data.y, transform: "translate(-50%, -100%) translateY(-8px)" }}
    >
      <span className="text-xs font-medium text-foreground">{data.symbol}</span>
    </div>
  )
}

function KyberswapLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 47 67" fill="#31CB9E" xmlns="http://www.w3.org/2000/svg">
      <path d="m20 33.51 25 14.32a1.32 1.32 0 0 0 2-1.14v-26.38a1.31 1.31 0 0 0 -2-1.13z" />
      <path d="m44.47 12.84-17.09-12.57a1.36 1.36 0 0 0 -2.14.73l-6.24 28 25.32-14a1.26 1.26 0 0 0 .15-2.15" />
      <path d="m27.36 66.74 17.11-12.57a1.28 1.28 0 0 0 -.14-2.17l-25.33-14 6.24 28a1.35 1.35 0 0 0 2.12.77" />
      <path d="m13.5 33 6.5-30.41a1.29 1.29 0 0 0 -2-1.31l-16.65 12.77a3.45 3.45 0 0 0 -1.35 2.75v32.4a3.45 3.45 0 0 0 1.35 2.8l16.57 12.72a1.29 1.29 0 0 0 2-1.31z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SwapRoutePreview({
  source,
  fromToken,
  toToken,
  routeInfo,
  kyberswapRouteSummary,
  tokenMetadata,
  isLoading = false,
  compact = false,
  networkMode,
}: SwapRoutePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [nodeTooltip, setNodeTooltip] = useState<NodeTooltipData | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = svgContainerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const addressMap = useMemo(
    () => buildAddressSymbolMap(fromToken, toToken, tokenMetadata, networkMode),
    [fromToken, toToken, tokenMetadata, networkMode],
  )

  const iconMap = useMemo(
    () => buildIconMap(tokenMetadata),
    [tokenMetadata],
  )

  const routes = useMemo(() => {
    if (source === "kyberswap" && kyberswapRouteSummary) {
      const parsed = parseSplitRoutes(kyberswapRouteSummary, addressMap)
        .filter((r) => r.percentage >= 0.5) // drop negligible splits
      // Normalize percentages to sum to 100% (Kyberswap can return inflated split amounts)
      const totalPct = parsed.reduce((s, r) => s + r.percentage, 0)
      const normalized = totalPct > 0
        ? parsed.map((r) => ({ ...r, percentage: (r.percentage / totalPct) * 100 }))
        : parsed
      // Normalize: force first token = fromToken.symbol, last = toToken.symbol
      // This prevents address-resolution mismatches from splitting first/last columns
      return normalized.map((r) => ({
        ...r,
        path: r.path.map((sym, i) => {
          if (i === 0) return fromToken.symbol
          if (i === r.path.length - 1) return toToken.symbol
          return sym
        }),
      }))
    }
    if (source === "alphix" && routeInfo) {
      return [{
        percentage: 100,
        path: routeInfo.path,
        // All Alphix pool hops show as "Custom Pool" with a single consistent color
        exchanges: routeInfo.pools.map(() => "Custom Pool"),
      }] as ParsedSplitRoute[]
    }
    return [] as ParsedSplitRoute[]
  }, [source, kyberswapRouteSummary, routeInfo, addressMap, fromToken.symbol, toToken.symbol])

  const exchangeColorMap = useMemo(() => buildExchangeColorMap(routes), [routes])
  const maxCols = useMemo(() => Math.max(...routes.map((r) => r.path.length), 0), [routes])

  const colMapping = useMemo(
    () => buildColumnMapping(routes, maxCols),
    [routes, maxCols],
  )

  // ---------------------------------------------------------------------------
  // Layout: single horizontal row, fixed height
  // ---------------------------------------------------------------------------

  // In compact mode, use smaller dimensions
  const cNODE_W = compact ? 28 : NODE_W
  const cNODE_H = compact ? 60 : NODE_H
  const cNODE_R = compact ? 4 : NODE_R
  const cICON_SIZE = compact ? 16 : ICON_SIZE
  const cV_PAD = compact ? 10 : V_PAD

  const layout = useMemo(() => {
    if (maxCols === 0 || routes.length === 0 || containerWidth === 0) return null

    const svgW = containerWidth
    const svgH = cV_PAD * 2 + cNODE_H

    const usableW = svgW - H_PAD * 2 - cNODE_W
    const colXs: number[] = []
    for (let c = 0; c < maxCols; c++) {
      const frac = maxCols === 1 ? 0.5 : c / (maxCols - 1)
      colXs.push(H_PAD + cNODE_W / 2 + frac * usableW)
    }

    const flowTop = cV_PAD + cNODE_R
    const flowBot = cV_PAD + cNODE_H - cNODE_R
    const totalGap = (routes.length - 1) * FLOW_GAP
    const totalFlowH = (flowBot - flowTop) - totalGap
    const routeSlices: { yTop: number; yBot: number }[] = []
    let cursor = flowTop
    for (const route of routes) {
      const h = Math.max(4, (route.percentage / 100) * totalFlowH)
      routeSlices.push({ yTop: cursor, yBot: cursor + h })
      cursor += h + FLOW_GAP
    }

    // Rescale if minimum-height floors caused slices to overflow available space
    // (happens when many small routes each get Math.max(4, ...) minimum)
    const endY = cursor - FLOW_GAP
    if (endY > flowBot && routeSlices.length > 0) {
      const totalSliceH = routeSlices.reduce((s, sl) => s + (sl.yBot - sl.yTop), 0)
      const availableForSlices = (flowBot - flowTop) - (routes.length - 1) * FLOW_GAP
      const scale = availableForSlices / totalSliceH
      let y = flowTop
      for (const slice of routeSlices) {
        const h = (slice.yBot - slice.yTop) * scale
        slice.yTop = y
        slice.yBot = y + h
        y += h + FLOW_GAP
      }
    }

    // Intermediate columns: compute token bars stacked proportionally,
    // and per-route sub-slots within each bar for band connections.
    type IntermediateBar = { symbol: string; yTop: number; yBot: number; routeIndices: number[] }
    const intermediateBarsByCol: IntermediateBar[][] = []
    const barSlotMap = new Map<string, { yTop: number; yBot: number }>()

    for (let c = 0; c < maxCols; c++) {
      if (c === 0 || c === maxCols - 1) {
        intermediateBarsByCol.push([])
        continue
      }

      // Collect unique tokens at this column and which routes use them
      const tokenMap = new Map<string, number[]>()
      for (let ri = 0; ri < routes.length; ri++) {
        for (let ti = 0; ti < routes[ri].path.length; ti++) {
          if (colMapping.get(`${ri}-${ti}`) === c) {
            const sym = routes[ri].path[ti]
            const existing = tokenMap.get(sym)
            if (existing) existing.push(ri)
            else tokenMap.set(sym, [ri])
            break
          }
        }
      }

      // Sort tokens by total percentage descending
      let tokenEntries = Array.from(tokenMap.entries())
        .map(([sym, ris]) => ({
          sym,
          ris,
          totalPct: ris.reduce((s, ri) => s + routes[ri].percentage, 0),
        }))
        .sort((a, b) => b.totalPct - a.totalPct)

      // Cap at 3 visible tokens — merge overflow into "+N"
      if (tokenEntries.length > 3) {
        const kept = tokenEntries.slice(0, 2)
        const overflow = tokenEntries.slice(2)
        const mergedRIs = overflow.flatMap((t) => t.ris)
        const mergedPct = overflow.reduce((s, t) => s + t.totalPct, 0)
        tokenEntries = [...kept, { sym: `+${overflow.length}`, ris: mergedRIs, totalPct: mergedPct }]
      }

      // Uniform bar sizes:
      // - Full height: only if 1 token AND all routes pass through this column
      // - 25% each: if multiple tokens, or if some routes skip this column
      const numBars = tokenEntries.length
      const bars: IntermediateBar[] = []

      const routesAtCol = new Set(tokenEntries.flatMap((t) => t.ris))
      const allRoutesHere = routesAtCol.size === routes.length

      if (numBars === 1 && allRoutesHere) {
        // All routes go through this single token → full height bar
        const { sym, ris } = tokenEntries[0]
        for (const ri of ris) {
          barSlotMap.set(`${c}-${ri}`, { yTop: routeSlices[ri].yTop, yBot: routeSlices[ri].yBot })
        }
        bars.push({ symbol: sym, yTop: cV_PAD, yBot: cV_PAD + cNODE_H, routeIndices: ris })
      } else {
        const barUnitH = cNODE_H * 0.25
        const barGap = 4

        tokenEntries.sort((a, b) => {
          const aCenter = a.ris.reduce((s, ri) =>
            s + ((routeSlices[ri].yTop + routeSlices[ri].yBot) / 2) * routes[ri].percentage, 0) / Math.max(1, a.totalPct)
          const bCenter = b.ris.reduce((s, ri) =>
            s + ((routeSlices[ri].yTop + routeSlices[ri].yBot) / 2) * routes[ri].percentage, 0) / Math.max(1, b.totalPct)
          return aCenter - bCenter
        })

        let minNextTop = cV_PAD
        const maxBot = cV_PAD + cNODE_H

        for (const { sym, ris } of tokenEntries) {
          const localPct = ris.reduce((s, ri) => s + routes[ri].percentage, 0)
          const weightedCenter = ris.reduce((s, ri) =>
            s + ((routeSlices[ri].yTop + routeSlices[ri].yBot) / 2) * routes[ri].percentage, 0) / Math.max(1, localPct)

          const idealTop = weightedCenter - barUnitH / 2
          const barTop = Math.max(minNextTop, Math.min(maxBot - barUnitH, idealTop))
          const barBot = barTop + barUnitH

          // Sub-slots: distribute routes proportionally within this bar,
          // inset from the bar's rounded corners so bands connect cleanly
          const sortedRIs = [...ris].sort((a, b) => routeSlices[a].yTop - routeSlices[b].yTop)
          const localTotalPct = sortedRIs.reduce((s, ri) => s + routes[ri].percentage, 0)
          const innerGap = sortedRIs.length > 1 ? FLOW_GAP : 0
          const totalInnerGaps = (sortedRIs.length - 1) * innerGap
          const barR = Math.min(cNODE_R, barUnitH / 2)
          const usableBarH = barUnitH - 2 * barR - totalInnerGaps

          let slotCursor = barTop + barR
          for (const ri of sortedRIs) {
            const h = Math.max(2, localTotalPct > 0
              ? (routes[ri].percentage / localTotalPct) * usableBarH
              : usableBarH / sortedRIs.length)
            barSlotMap.set(`${c}-${ri}`, { yTop: slotCursor, yBot: slotCursor + h })
            slotCursor += h + innerGap
          }

          bars.push({ symbol: sym, yTop: barTop, yBot: barBot, routeIndices: ris })
          minNextTop = barBot + barGap
        }
      }

      intermediateBarsByCol.push(bars)
    }

    return { svgW, svgH, colXs, routeSlices, intermediateBarsByCol, barSlotMap }
  }, [maxCols, routes, containerWidth, colMapping, cNODE_W, cNODE_H, cNODE_R, cV_PAD])

  // Hover handlers
  const handleBandHover = useCallback(
    (e: React.MouseEvent, routeIdx: number, hopIdx: number) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const route = routes[routeIdx]
      const exchange = route.exchanges[hopIdx] || "Unknown"
      const color = exchangeColorMap.get(exchange.toLowerCase()) || ROUTE_COLORS[ROUTE_COLORS.length - 1]
      setTooltip({
        exchange, color,
        percentage: route.percentage,
        fromSymbol: route.path[hopIdx],
        toSymbol: route.path[hopIdx + 1],
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    },
    [routes, exchangeColorMap],
  )

  const handleBandMove = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || !tooltip) return
      const rect = containerRef.current.getBoundingClientRect()
      setTooltip((prev) => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
    },
    [tooltip],
  )

  const handleBandLeave = useCallback(() => setTooltip(null), [])

  const handleNodeHover = useCallback(
    (e: React.MouseEvent, sym: string) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setNodeTooltip({ symbol: sym, x: e.clientX - rect.left, y: e.clientY - rect.top })
    },
    [],
  )

  const handleNodeMove = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || !nodeTooltip) return
      const rect = containerRef.current.getBoundingClientRect()
      setNodeTooltip((prev) => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
    },
    [nodeTooltip],
  )

  const handleNodeLeave = useCallback(() => setNodeTooltip(null), [])

  const hasRoutes = routes.length > 0
  const isSplitRoute = routes.length > 1

  // ---------------------------------------------------------------------------
  // Build bands
  // ---------------------------------------------------------------------------

  const bands: { d: string; color: string; routeIdx: number; hopIdx: number }[] = []

  if (layout && hasRoutes) {
    const { colXs, routeSlices, barSlotMap } = layout

    // Resolve y-range for a route at a given column:
    // - First/last columns: use global routeSlices (the FROM/TO bar)
    // - Intermediate columns: use the route's sub-slot within its token bar
    const getRouteY = (ri: number, col: number) => {
      if (col === 0 || col === maxCols - 1) return routeSlices[ri]
      return barSlotMap.get(`${col}-${ri}`) || routeSlices[ri]
    }

    for (let ri = 0; ri < routes.length; ri++) {
      const route = routes[ri]

      for (let hop = 0; hop < route.path.length - 1; hop++) {
        const fromCol = colMapping.get(`${ri}-${hop}`)!
        const toCol = colMapping.get(`${ri}-${hop + 1}`)!

        const x1 = colXs[fromCol] + cNODE_W / 2
        const x2 = colXs[toCol] - cNODE_W / 2

        const fromY = getRouteY(ri, fromCol)
        const toY = getRouteY(ri, toCol)

        const exchange = route.exchanges[hop] || "Unknown"
        const color = exchangeColorMap.get(exchange.toLowerCase()) || ROUTE_COLORS[ROUTE_COLORS.length - 1]

        bands.push({
          d: sankeyPath(x1, fromY.yTop, fromY.yBot, x2, toY.yTop, toY.yBot),
          color,
          routeIdx: ri,
          hopIdx: hop,
        })
      }
    }
  }

  // Legend
  const legendEntries = Array.from(exchangeColorMap.entries()).map(([name, color]) => ({
    name: titleCase(name),
    color,
  }))

  return (
    <div ref={containerRef} className={`relative rounded-lg ${compact ? "border border-sidebar-border/40 bg-container-secondary overflow-visible" : "border border-primary bg-container-secondary overflow-hidden"}`}>
      {/* Header — hidden in compact mode (parent provides its own label) */}
      {!compact && (
        <div className="relative z-10 flex items-center justify-between px-4 py-2 border-b border-primary bg-container-secondary">
          <div className="flex items-center gap-2">
            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">ROUTE</h2>
          </div>
          {source === "kyberswap" && (
            <a
              href="https://kyberswap.com/swap"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <KyberswapLogo size={14} />
              <span className="text-[11px] text-muted-foreground font-medium">via Kyberswap</span>
            </a>
          )}
          {source === "alphix" && (
            <div className="flex items-center gap-1.5">
              <Image src="/logos/alphix-icon-white.svg" alt="Alphix" width={14} height={14} className="opacity-80" />
              <span className="text-[11px] text-muted-foreground font-medium">via Alphix</span>
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #333333 1px, transparent 1px)",
            backgroundSize: compact ? "16px 16px" : "24px 24px",
          }}
        />

        <div ref={svgContainerRef} className={`relative w-full ${compact ? "px-3" : "px-4"}`}>
          {isLoading ? (
            <div className="flex items-center justify-center" style={{ minHeight: layout ? layout.svgH : compact ? 80 : 120 }}>
              <div className="animate-pulse">
                <Image src="/logos/alphix-icon-white.svg" alt="Loading" width={24} height={24} className="opacity-60" />
              </div>
            </div>
          ) : layout && (
            <svg
              width={layout.svgW}
              height={layout.svgH}
              viewBox={`0 0 ${layout.svgW} ${layout.svgH}`}
              className="block w-full"
            >
              {/* Flow bands (behind nodes) */}
              {bands.map((band, i) => {
                const isHovered = tooltip?.exchange.toLowerCase() === routes[band.routeIdx].exchanges[band.hopIdx]?.toLowerCase()
                const isDimmed = tooltip && !isHovered
                return (
                  <path
                    key={`band-${i}`}
                    d={band.d}
                    fill={band.color}
                    fillOpacity={isDimmed ? 0.06 : 0.25}
                    stroke={band.color}
                    strokeWidth={1}
                    strokeOpacity={isDimmed ? 0.08 : 0.4}
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={(e) => handleBandHover(e, band.routeIdx, band.hopIdx)}
                    onMouseMove={handleBandMove}
                    onMouseLeave={handleBandLeave}
                  />
                )
              })}

              {/* Percentage visible on hover via FlowTooltip */}

              {/* First column node: FROM token — single full-height bar */}
              {(() => {
                const x = layout.colXs[0]
                const icon = fromToken.icon
                const centerY = cV_PAD + cNODE_H / 2
                return (
                  <g
                    className="cursor-pointer"
                    onMouseEnter={(e) => handleNodeHover(e, fromToken.symbol)}
                    onMouseMove={handleNodeMove}
                    onMouseLeave={handleNodeLeave}
                  >
                    <rect x={x - cNODE_W / 2} y={cV_PAD} width={cNODE_W} height={cNODE_H} rx={cNODE_R} ry={cNODE_R} fill="#1a1a1a" stroke="#323232" strokeWidth={1} />
                    <foreignObject x={x - cICON_SIZE / 2} y={centerY - cICON_SIZE / 2} width={cICON_SIZE} height={cICON_SIZE}>
                      <TokenImage src={icon} alt={fromToken.symbol} size={cICON_SIZE} />
                    </foreignObject>
                  </g>
                )
              })()}

              {/* Last column node: TO token — single full-height bar */}
              {maxCols > 1 && (() => {
                const x = layout.colXs[maxCols - 1]
                const icon = toToken.icon
                const centerY = cV_PAD + cNODE_H / 2
                return (
                  <g
                    className="cursor-pointer"
                    onMouseEnter={(e) => handleNodeHover(e, toToken.symbol)}
                    onMouseMove={handleNodeMove}
                    onMouseLeave={handleNodeLeave}
                  >
                    <rect x={x - cNODE_W / 2} y={cV_PAD} width={cNODE_W} height={cNODE_H} rx={cNODE_R} ry={cNODE_R} fill="#1a1a1a" stroke="#323232" strokeWidth={1} />
                    <foreignObject x={x - cICON_SIZE / 2} y={centerY - cICON_SIZE / 2} width={cICON_SIZE} height={cICON_SIZE}>
                      <TokenImage src={icon} alt={toToken.symbol} size={cICON_SIZE} />
                    </foreignObject>
                  </g>
                )
              })()}

              {/* Intermediate column nodes: uniform-height bars per unique token */}
              {layout.intermediateBarsByCol.map((bars, col) =>
                bars.map((bar) => {
                  const x = layout.colXs[col]
                  const barH = bar.yBot - bar.yTop
                  const centerY = (bar.yTop + bar.yBot) / 2
                  const isOverflow = bar.symbol.startsWith("+")
                  const icon = isOverflow ? "" : resolveTokenIcon(bar.symbol, fromToken, toToken, iconMap)
                  const isPlaceholder = !isOverflow && (!icon || icon === "/tokens/placeholder.svg")
                  const showIcon = barH >= cICON_SIZE + 4
                  const tooltipLabel = isOverflow ? `${bar.symbol} more` : bar.symbol
                  return (
                    <g
                      key={`mid-${col}-${bar.symbol}`}
                      className="cursor-pointer"
                      onMouseEnter={(e) => handleNodeHover(e, tooltipLabel)}
                      onMouseMove={handleNodeMove}
                      onMouseLeave={handleNodeLeave}
                    >
                      <rect
                        x={x - cNODE_W / 2}
                        y={bar.yTop}
                        width={cNODE_W}
                        height={barH}
                        rx={Math.min(cNODE_R, barH / 2)}
                        ry={Math.min(cNODE_R, barH / 2)}
                        fill="#1a1a1a"
                        stroke="#323232"
                        strokeWidth={1}
                      />
                      {isOverflow ? (
                        <text
                          x={x}
                          y={centerY + 4}
                          textAnchor="middle"
                          className="text-[10px] font-semibold pointer-events-none"
                          fill="#888"
                        >
                          {bar.symbol}
                        </text>
                      ) : showIcon && (
                        isPlaceholder ? (
                          <circle cx={x} cy={centerY} r={cICON_SIZE / 2} fill="#2D2D2D" stroke="#454545" strokeWidth={1} />
                        ) : (
                          <foreignObject x={x - cICON_SIZE / 2} y={centerY - cICON_SIZE / 2} width={cICON_SIZE} height={cICON_SIZE}>
                            <TokenImage src={icon} alt={bar.symbol} size={cICON_SIZE} />
                          </foreignObject>
                        )
                      )}
                    </g>
                  )
                }),
              )}
            </svg>
          )}
        </div>

        {/* Legend (hidden in compact mode) */}
        {!compact && !isLoading && legendEntries.length > 0 && (
          <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1 py-2 px-4">
            {legendEntries.map((entry) => (
              <div key={entry.name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded shrink-0" style={{ backgroundColor: entry.color }} />
                <span className="text-[10px] text-muted-foreground">{entry.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Compact source badge removed — parent provides "Route" + "via X" header */}
      </div>

      {tooltip && <FlowTooltip data={tooltip} compact={compact} />}
      {nodeTooltip && <NodeTooltip data={nodeTooltip} />}
    </div>
  )
}
