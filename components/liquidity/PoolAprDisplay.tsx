/**
 * PoolAprDisplay - Displays APR with consistent formatting
 * Mirrors Uniswap's PoolDetailsApr.tsx pattern
 */

import { Percent } from '@uniswap/sdk-core'
import { formatApr } from '@/lib/apr'

interface PoolAprDisplayProps {
  apr: Percent | null | undefined
  aprNumber?: number | null
  showLabel?: boolean
  className?: string
  labelClassName?: string
}

export function PoolAprDisplay({
  apr,
  aprNumber,
  showLabel = true,
  className = '',
  labelClassName = '',
}: PoolAprDisplayProps) {
  // Support both Percent and raw number inputs
  const displayValue = apr
    ? formatApr(apr)
    : aprNumber !== null && aprNumber !== undefined
      ? formatAprFromNumber(aprNumber)
      : '–'

  return (
    <div className={className}>
      <span>{displayValue}</span>
      {showLabel && <span className={labelClassName}>APR</span>}
    </div>
  )
}

function formatAprFromNumber(value: number): string {
  if (!isFinite(value)) return '-'
  if (value === 0) return '0%'
  if (value >= 1000) return `${Math.round(value)}%`
  if (value >= 100) return `${value.toFixed(0)}%`
  if (value >= 10) return `${value.toFixed(1)}%`
  return `${value.toFixed(2)}%`
}

export default PoolAprDisplay
