'use client'

import { useEffect, useState } from 'react'
import { fetchPoolsMetrics } from '@/lib/backend-client'
import { SeasonIcon } from '@/components/PointsIcons'

const formatUSD = (value: number) => {
  if (!isFinite(value)) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function PulsingLiveDot() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 8, height: 8 }}>
      {/* Outer pulsing ring 1 */}
      <div
        className="absolute rounded-full animate-pulse-ring"
        style={{
          width: 8,
          height: 8,
          backgroundColor: 'rgb(34, 197, 94)',
          opacity: 0.3,
        }}
      />
      {/* Outer pulsing ring 2 (staggered) */}
      <div
        className="absolute rounded-full animate-pulse-ring"
        style={{
          width: 8,
          height: 8,
          backgroundColor: 'rgb(34, 197, 94)',
          opacity: 0.3,
          animationDelay: '0.5s',
        }}
      />
      {/* Inner solid dot */}
      <div
        className="absolute rounded-full"
        style={{
          width: 8,
          height: 8,
          backgroundColor: 'rgb(34, 197, 94)',
        }}
      />
    </div>
  )
}

/** TVL display component - shows total value locked */
export function TVLDisplay({ className }: { className?: string }) {
  const [tvl, setTvl] = useState<number | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetchPoolsMetrics('mainnet')
        if (response.success && Array.isArray(response.pools)) {
          const totalTvl = response.pools.reduce((sum, pool) => sum + (pool.tvlUsd || 0), 0)
          setTvl(totalTvl)
        }
      } catch {
        // Silently fail
      }
    }
    fetchStats()
  }, [])

  const isLoading = tvl === null

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="text-sm text-muted-foreground">TVL</span>
      {isLoading ? (
        <span className="inline-block h-5 w-16 bg-muted/40 rounded animate-pulse" />
      ) : (
        <span className="text-sm font-semibold text-white" style={{ fontFamily: 'Consolas, monospace' }}>
          {formatUSD(tvl)}
        </span>
      )}
    </div>
  )
}

/** Season badge component - shows current season indicator */
export function SeasonBadge({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <PulsingLiveDot />
      <span className="text-sm font-medium text-foreground">Season</span>
      <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-white/10 backdrop-blur-sm">
        <SeasonIcon className="w-3 h-3 text-white/70" />
      </div>
    </div>
  )
}

/** Combined stats bar - for backward compatibility */
export function ProtocolStatsBar({ className }: { className?: string }) {
  return (
    <div className={`flex items-center justify-between w-full ${className ?? ''}`}>
      <TVLDisplay />
      <SeasonBadge />
    </div>
  )
}

// Legacy exports
export const ProtocolStats = ProtocolStatsBar
export const TVLTicker = ProtocolStatsBar
