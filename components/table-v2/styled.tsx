"use client"

import { forwardRef, PropsWithChildren, HTMLAttributes, CSSProperties } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { zIndexes } from './utils'
import { IconArrowUp, IconArrowDown } from "nucleo-micro-bold-essential"

// Constants
export const SHOW_RETURN_TO_TOP_OFFSET = 500
export const LOAD_MORE_BOTTOM_OFFSET = 50

// Breakpoints (matching Uniswap)
export const breakpoints = {
  sm: 450,
  md: 640,
  lg: 768,
  xl: 1024,
  xxl: 1280,
}

// ============================================================================
// TableContainer - Main wrapper with max-width constraint
// ============================================================================
interface TableContainerProps extends HTMLAttributes<HTMLDivElement> {
  maxWidth?: number
  maxHeight?: number
}

export const TableContainer = forwardRef<HTMLDivElement, TableContainerProps>(
  ({ maxWidth, maxHeight, className, style, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center w-full mx-auto mb-6 scrollbar-hidden",
        className
      )}
      style={{
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
)
TableContainer.displayName = 'TableContainer'

// ============================================================================
// TableHead - Sticky header wrapper
// ============================================================================
interface TableHeadProps extends PropsWithChildren {
  $isSticky: boolean
  $top: number
}

export const TableHead = ({ $isSticky, $top, children }: TableHeadProps) => (
  <div
    className={cn(
      "w-full flex flex-col justify-end bg-background scrollbar-hidden",
      $isSticky && "sticky"
    )}
    style={{
      zIndex: zIndexes.dropdown - 2,
      top: $isSticky ? $top : undefined,
    }}
  >
    {$isSticky && <div className="h-3" />}
    {children}
  </div>
)

// ============================================================================
// TableBodyContainer - Scrollable body container
// ============================================================================
interface TableBodyContainerProps extends PropsWithChildren {
  maxHeight?: number | string
  v2?: boolean
}

export const TableBodyContainer = forwardRef<HTMLDivElement, TableBodyContainerProps>(
  ({ maxHeight, v2 = true, children }, ref) => (
    <div
      ref={ref}
      className={cn(
        "w-full relative scrollbar-hidden overflow-x-auto overflow-y-auto",
        v2 ? "rounded-b-lg border-0" : "rounded-b-2xl border border-t-0 border-sidebar-border"
      )}
      style={{
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        overscrollBehaviorX: 'none',
      }}
    >
      {children}
    </div>
  )
)
TableBodyContainer.displayName = 'TableBodyContainer'

// ============================================================================
// Loading Indicator
// ============================================================================
export const LoadingIndicatorContainer = ({ children }: PropsWithChildren) => (
  <div
    className="flex flex-row items-center justify-center -mt-12 sticky"
    style={{ zIndex: zIndexes.sticky }}
  >
    {children}
  </div>
)

export const LoadingIndicator = ({ children }: PropsWithChildren) => (
  <div className="flex flex-row items-center gap-2 bg-primary/20 rounded-lg w-fit p-2 h-[34px]">
    {children}
  </div>
)

// ============================================================================
// Table Row Components
// ============================================================================
interface TableRowBaseProps extends HTMLAttributes<HTMLDivElement> {
  v2?: boolean
  height?: number
}

const TableRowBase = forwardRef<HTMLDivElement, TableRowBaseProps>(
  ({ v2 = true, height, className, style, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-row items-center w-full min-w-full transition-colors duration-100",
        v2 ? "rounded-lg" : "rounded-2xl",
        className
      )}
      style={{ height: height ? `${height}px` : undefined, ...style }}
      {...props}
    >
      {children}
    </div>
  )
)
TableRowBase.displayName = 'TableRowBase'

export const DataRow = forwardRef<HTMLDivElement, TableRowBaseProps>(
  ({ v2 = true, className, ...props }, ref) => (
    <TableRowBase
      ref={ref}
      v2={v2}
      className={cn("hover:bg-muted/40", className)}
      {...props}
    />
  )
)
DataRow.displayName = 'DataRow'

export const NoDataFoundTableRow = forwardRef<HTMLDivElement, TableRowBaseProps>(
  ({ className, ...props }, ref) => (
    <TableRowBase
      ref={ref}
      className={cn("justify-center", className)}
      {...props}
    />
  )
)
NoDataFoundTableRow.displayName = 'NoDataFoundTableRow'

// ============================================================================
// Header Row
// ============================================================================
interface HeaderRowProps extends HTMLAttributes<HTMLDivElement> {
  dimmed?: boolean
  v2?: boolean
}

export const HeaderRow = forwardRef<HTMLDivElement, HeaderRowProps>(
  ({ dimmed, v2 = true, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-row items-center w-full min-w-full transition-colors duration-100 overflow-auto scrollbar-hidden",
        v2
          ? "bg-muted/50 rounded-xl surface-depth"
          : "bg-muted border border-sidebar-border rounded-t-2xl",
        dimmed && "opacity-40",
        className
      )}
      style={{ overscrollBehavior: 'none' }}
      {...props}
    >
      {children}
    </div>
  )
)
HeaderRow.displayName = 'HeaderRow'

// ============================================================================
// Table Scroll Mask (gradient fade)
// ============================================================================
interface TableScrollMaskProps {
  top?: number | string
  right?: number
  zIndex?: number
  borderTopRightRadius?: string
  borderBottomRightRadius?: string
}

export const TableScrollMask = ({
  top = 0,
  right = 1,
  zIndex = zIndexes.default,
  borderTopRightRadius,
  borderBottomRightRadius,
}: TableScrollMaskProps) => (
  <div
    className="absolute w-5 pointer-events-none"
    style={{
      top: typeof top === 'number' ? `${top}px` : top,
      bottom: 0,
      right: `${right}px`,
      zIndex,
      borderTopRightRadius,
      borderBottomRightRadius,
      background: 'linear-gradient(to right, transparent, hsl(var(--background)))',
    }}
  />
)

// ============================================================================
// Cell Container
// ============================================================================
interface CellContainerProps extends HTMLAttributes<HTMLDivElement> {}

export const CellContainer = forwardRef<HTMLDivElement, CellContainerProps>(
  ({ className, style, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex-grow [&:first-child]:flex-grow-0",
        className
      )}
      style={style}
      {...props}
    >
      {children}
    </div>
  )
)
CellContainer.displayName = 'CellContainer'

// ============================================================================
// Table Row Link
// ============================================================================
interface TableRowLinkProps {
  href: string
  state?: unknown
  children: React.ReactNode
  className?: string
  'data-testid'?: string
}

export const TableRowLink = ({ href, children, className, ...props }: TableRowLinkProps) => (
  <Link
    href={href}
    className={cn("cursor-pointer no-underline", className)}
    {...props}
  >
    {children}
  </Link>
)

// ============================================================================
// Header Components
// ============================================================================
interface ClickableHeaderRowProps extends HTMLAttributes<HTMLDivElement> {}

export const ClickableHeaderRow = forwardRef<HTMLDivElement, ClickableHeaderRowProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-row items-center justify-end cursor-pointer transition-opacity hover:opacity-60",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
ClickableHeaderRow.displayName = 'ClickableHeaderRow'

interface HeaderArrowProps {
  orderDirection?: 'asc' | 'desc'
  className?: string
}

export const HeaderArrow = ({ orderDirection, className }: HeaderArrowProps) => {
  const Icon = orderDirection === 'asc' ? IconArrowUp : IconArrowDown
  return (
    <Icon
      className={cn(
        "h-3.5 w-3.5 text-foreground transition-opacity duration-75 group-hover:opacity-50",
        className
      )}
    />
  )
}

interface HeaderSortTextProps extends PropsWithChildren {
  active?: boolean
  className?: string
}

export const HeaderSortText = ({ active, className, children }: HeaderSortTextProps) => (
  <span
    className={cn(
      "text-sm whitespace-nowrap",
      active ? "text-foreground" : "text-muted-foreground",
      className
    )}
  >
    {children}
  </span>
)

// ============================================================================
// Filter Header Row
// ============================================================================
interface FilterHeaderRowProps extends HTMLAttributes<HTMLDivElement> {
  clickable?: boolean
}

export const FilterHeaderRow = forwardRef<HTMLDivElement, FilterHeaderRowProps>(
  ({ clickable, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-row items-center select-none gap-1 transition-all duration-100",
        clickable && "cursor-pointer hover:opacity-60",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
FilterHeaderRow.displayName = 'FilterHeaderRow'

// ============================================================================
// Table Text Components
// ============================================================================
interface TableTextProps extends PropsWithChildren {
  className?: string
}

export const TableText = ({ className, children }: TableTextProps) => (
  <span className={cn("text-sm text-foreground", className)}>
    {children}
  </span>
)

export const EllipsisText = ({ className, children }: TableTextProps) => (
  <TableText className={cn("whitespace-nowrap overflow-hidden text-ellipsis", className)}>
    {children}
  </TableText>
)
