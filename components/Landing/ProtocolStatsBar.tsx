'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { fetchAllPoolsMetrics } from '@/lib/backend-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(value: number): string {
  if (!isFinite(value)) return '$0.00'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// ---------------------------------------------------------------------------
// Generic history sparkline (shared layout/hover/tooltip)
// ---------------------------------------------------------------------------

interface HistoryPoint {
  timestamp: number
  value: number
}

function HistorySparkline({
  endpoint,
  valueKey,
}: {
  endpoint: string
  valueKey: string
}) {
  const [points, setPoints] = useState<HistoryPoint[]>([])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(endpoint)
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled && Array.isArray(json.data)) {
          const normalized: HistoryPoint[] = json.data
            .map((d: Record<string, number>) => ({
              timestamp: Number(d.timestamp),
              value: Number(d[valueKey]),
            }))
            .filter((p: HistoryPoint) => Number.isFinite(p.timestamp) && Number.isFinite(p.value))
          setPoints(normalized)
        }
      } catch {
        // silently fail
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [endpoint, valueKey])

  const W = 160
  const H = 64
  const PAD = 4

  const { pathD, coords } = useMemo(() => {
    if (!points || points.length < 2) return { pathD: null, coords: [] as { x: number; y: number }[] }

    const values = points.map((p) => p.value)
    const mn = Math.min(...values)
    const mx = Math.max(...values)
    const range = mx - mn || 1

    const c: { x: number; y: number }[] = []
    const d = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * W
        const y = PAD + ((mx - v) / range) * (H - PAD * 2)
        c.push({ x, y })
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

    return { pathD: d, coords: c }
  }, [points])

  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null
  const hoveredCoord = hoveredIndex !== null ? coords[hoveredIndex] : null

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!points || points.length < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = x / rect.width
    const idx = Math.round(pct * (points.length - 1))
    setHoveredIndex(Math.max(0, Math.min(idx, points.length - 1)))
  }

  if (!pathD) return <PlaceholderSparkline />

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        fill="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <path
          d={pathD}
          stroke="#9B9B9B"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hoveredCoord && (
          <>
            <line
              x1={hoveredCoord.x}
              y1={0}
              x2={hoveredCoord.x}
              y2={H}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="0.5"
            />
            <circle
              cx={hoveredCoord.x}
              cy={hoveredCoord.y}
              r="2"
              fill="#fff"
              stroke="#9B9B9B"
              strokeWidth="1"
            />
          </>
        )}
      </svg>
      {hoveredPoint && (
        <div
          className="absolute -top-6 pointer-events-none z-10"
          style={{
            left: `${((hoveredIndex ?? 0) / ((points?.length ?? 1) - 1)) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="flex items-center rounded-md bg-popover border border-sidebar-border px-1.5 h-5 shadow-sm whitespace-nowrap">
            <span className="text-[10px] text-muted-foreground mr-1.5">
              {new Date(hoveredPoint.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <span className="text-[10px] font-medium text-foreground">
              {formatUSD(hoveredPoint.value)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// Placeholder for cards without a data stream yet — subtle muted flat-dashed line
function PlaceholderSparkline() {
  return (
    <svg viewBox="0 0 160 64" className="w-full h-full" fill="none">
      <line
        x1="0"
        y1="32"
        x2="160"
        y2="32"
        stroke="#3a3a3a"
        strokeWidth="1"
        strokeDasharray="3 4"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  isLoading,
  sparkline,
  hideOnMobile = false,
}: {
  label: string
  value: string
  isLoading: boolean
  sparkline: React.ReactNode
  hideOnMobile?: boolean
}) {
  return (
    <Link
      href="/liquidity"
      className={`relative z-10 flex-1 items-center justify-between gap-4 rounded-lg bg-muted/50 surface-depth px-5 md:px-6 py-4 min-w-0 hover:bg-muted/70 transition-colors text-left ${
        hideOnMobile ? 'hidden md:flex' : 'flex'
      }`}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className="text-lg font-semibold">
          {isLoading ? (
            <span className="inline-block h-[1em] w-20 bg-muted/60 rounded animate-pulse align-middle" />
          ) : (
            value
          )}
        </span>
      </div>
      <div className="flex w-[140px] md:w-[160px] h-14 -my-3 -mr-2 md:-mr-3 flex-shrink-0">
        {sparkline}
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// ProtocolStatsBar (exported)
// ---------------------------------------------------------------------------

interface Aggregates {
  tvl: number
  volume24h: number
  fees: number
}

export function ProtocolStatsBar() {
  const [stats, setStats] = useState<Aggregates | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetchAllPoolsMetrics()
        if (cancelled) return
        if (response.success && Array.isArray(response.pools)) {
          const agg = response.pools.reduce<Aggregates>(
            (acc, pool) => {
              if (typeof pool.tvlUsd === 'number' && isFinite(pool.tvlUsd)) acc.tvl += pool.tvlUsd
              if (typeof pool.volume24hUsd === 'number' && isFinite(pool.volume24hUsd)) acc.volume24h += pool.volume24hUsd
              if (typeof pool.cumulativeFeesUsd === 'number' && isFinite(pool.cumulativeFeesUsd)) acc.fees += pool.cumulativeFeesUsd
              return acc
            },
            { tvl: 0, volume24h: 0, fees: 0 }
          )
          setStats(agg)
        } else {
          setStats({ tvl: 0, volume24h: 0, fees: 0 })
        }
      } catch {
        if (!cancelled) setStats({ tvl: 0, volume24h: 0, fees: 0 })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const isLoading = stats === null

  return (
    <div className="flex w-full max-w-5xl mx-auto flex-col gap-3 md:flex-row md:gap-3">
      <StatCard
        label="TVL"
        value={formatUSD(stats?.tvl ?? 0)}
        isLoading={isLoading}
        sparkline={<HistorySparkline endpoint="/api/protocol/tvl-history" valueKey="tvlUsd" />}
      />
      <StatCard
        label="Volume (24h)"
        value={formatUSD(stats?.volume24h ?? 0)}
        isLoading={isLoading}
        sparkline={<HistorySparkline endpoint="/api/protocol/volume-history" valueKey="volume24hUsd" />}
        hideOnMobile
      />
      <StatCard
        label="User Revenue"
        value={stats && stats.fees > 0 ? formatUSD(stats.fees) : '---'}
        isLoading={isLoading}
        sparkline={<HistorySparkline endpoint="/api/protocol/user-revenue-history" valueKey="userRevenueUsd" />}
        hideOnMobile
      />
    </div>
  )
}
