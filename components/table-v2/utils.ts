import { Column, RowData } from '@tanstack/react-table'
import { CSSProperties } from 'react'

// Theme constants (matching our Tailwind/CSS variables)
export const zIndexes = {
  background: 0,
  default: 10,
  dropdown: 50,
  sticky: 100,
  mask: 40,
}

export const padding = {
  padding8: 8,
  padding12: 12,
  padding16: 16,
}

// Color type for our simple color system
export type TableColors = {
  surface1: string
  surface2: string
  surface3: string
}

// Default colors using CSS variables (will inherit from your theme)
export const getDefaultColors = (): TableColors => ({
  surface1: 'hsl(var(--background))',
  surface2: 'hsl(var(--muted))',
  surface3: 'hsl(var(--border))',
})

/**
 * Displays the time as a human-readable string.
 */
export function formatAbbreviatedTime(timestamp: number): string {
  const now = Date.now()
  const timeSince = now - timestamp
  const secondsPassed = Math.floor(timeSince / 1000)
  const minutesPassed = Math.floor(secondsPassed / 60)
  const hoursPassed = Math.floor(minutesPassed / 60)
  const daysPassed = Math.floor(hoursPassed / 24)
  const monthsPassed = Math.floor(daysPassed / 30)

  if (monthsPassed > 0) return `${monthsPassed}mo`
  if (daysPassed > 0) return `${daysPassed}d`
  if (hoursPassed > 0) return `${hoursPassed}h`
  if (minutesPassed > 0) return `${minutesPassed}m`
  return `${secondsPassed}s`
}

/**
 * Returns sizing styles for table columns (width and flexGrow).
 */
export function getColumnSizingStyles<Data extends RowData>(column: Column<Data, unknown>): CSSProperties {
  const metaFlexGrow = (column.columnDef.meta as { flexGrow?: number } | undefined)?.flexGrow

  const styles: CSSProperties = {
    width: column.getSize(),
  }

  // Only override flexGrow if explicitly set in meta
  if (metaFlexGrow !== undefined) {
    styles.flexGrow = metaFlexGrow
  }

  return styles
}

export function getCommonPinningStyles<Data extends RowData>({
  column,
  colors,
  isHeader = false,
}: {
  column: Column<Data, unknown>
  colors: TableColors
  isHeader?: boolean
}): CSSProperties {
  const isPinned = column.getIsPinned()
  const isLastPinnedColumn = column.getIsLastColumn('left')

  return {
    ...getColumnSizingStyles(column),
    left: isPinned === 'left' ? `${column.getStart('left')}px` : 0,
    position: isPinned ? 'sticky' : 'relative',
    zIndex: isPinned ? zIndexes.default : zIndexes.background,
    background: isPinned ? (isHeader ? colors.surface2 : colors.surface1) : 'transparent',
    borderRight: isLastPinnedColumn ? `1px solid ${colors.surface3}` : undefined,
    paddingLeft: column.getIsFirstColumn() ? `${padding.padding16}px` : 0,
    paddingRight: column.getIsLastColumn() || isLastPinnedColumn ? `${padding.padding16}px` : 0,
    height: '100%',
    display: 'flex',
    // Don't set justifyContent here - let cells control their own alignment
  }
}
