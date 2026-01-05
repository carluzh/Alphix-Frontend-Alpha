"use client"

import { forwardRef, PropsWithChildren, CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useTableSize } from './TableSizeProvider'
import { breakpoints } from './styled'

interface CellProps {
  loading?: boolean
  testId?: string
  justifyContent?: 'flex-start' | 'flex-end' | 'center'
  alignItems?: 'flex-start' | 'flex-end' | 'center'
  px?: number
  py?: number
  gap?: number
  className?: string
  style?: CSSProperties
}

export const Cell = forwardRef<HTMLDivElement, PropsWithChildren<CellProps>>(
  (
    {
      loading,
      children,
      testId,
      justifyContent = 'flex-end',
      alignItems = 'center',
      px = 12,
      py,
      gap,
      className,
      style,
    },
    ref,
  ) => {
    const { width: tableWidth } = useTableSize()
    const isCompact = tableWidth <= breakpoints.lg
    const paddingY = py ?? (isCompact ? 12 : 16)
    const loadingHeight = isCompact ? 32 : 16

    return (
      <div
        ref={ref}
        data-testid={testId}
        className={cn(
          "flex flex-row overflow-hidden items-center w-full h-full",
          className
        )}
        style={{
          fontVariantNumeric: 'lining-nums tabular-nums',
          justifyContent,
          alignItems,
          paddingLeft: px,
          paddingRight: px,
          paddingTop: paddingY,
          paddingBottom: paddingY,
          gap: gap ? `${gap}px` : undefined,
          ...style,
        }}
      >
        {loading ? (
          <div
            className="bg-muted/60 rounded animate-pulse"
            style={{ height: loadingHeight, width: '75%' }}
            data-testid="cell-loading-bubble"
          />
        ) : (
          children
        )}
      </div>
    )
  },
)

Cell.displayName = 'Cell'

// HeaderCell with default py=12
export const HeaderCell = forwardRef<HTMLDivElement, PropsWithChildren<CellProps>>(
  (props, ref) => {
    return <Cell ref={ref} py={12} {...props} />
  },
)

HeaderCell.displayName = 'HeaderCell'
