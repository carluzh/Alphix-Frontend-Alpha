"use client"

import { ColumnDef, flexRender, getCoreRowModel, Row, RowData, useReactTable } from '@tanstack/react-table'
import { useParentSize } from '@visx/responsive'
import { Loader2 } from 'lucide-react'
import { ScrollButton, ScrollButtonProps } from './ScrollButton'
import {
  CellContainer,
  HeaderRow,
  LOAD_MORE_BOTTOM_OFFSET,
  LoadingIndicator,
  LoadingIndicatorContainer,
  SHOW_RETURN_TO_TOP_OFFSET,
  TableBodyContainer,
  TableContainer,
  TableHead,
  TableScrollMask,
} from './styled'
import { TableBody } from './TableBody'
import { TableSizeProvider } from './TableSizeProvider'
import { getCommonPinningStyles, getDefaultColors, zIndexes } from './utils'
import { useCallback, useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { ScrollSync, ScrollSyncPane } from 'react-scroll-sync'

// Default nav height (adjust to match your app header)
const INTERFACE_NAV_HEIGHT = 64

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

function calculateScrollButtonTop(params: {
  maxHeight?: number
  isSticky: boolean
  centerArrows: boolean
  height: number
  headerHeight: number
}): number {
  const { maxHeight, isSticky, centerArrows, height, headerHeight } = params

  if (centerArrows && height > 0) {
    return height / 2
  }

  if (maxHeight) {
    return height / 2
  }

  if (isSticky && typeof window !== 'undefined') {
    return (window.innerHeight - (headerHeight + 12)) / 2
  }

  return 0
}

export function Table<T extends RowData>({
  columns,
  data,
  loading,
  error,
  loadMore,
  maxWidth,
  maxHeight,
  defaultPinnedColumns = [],
  forcePinning = false,
  v2 = true,
  hideHeader = false,
  externalScrollSync = false,
  scrollGroup = 'table-sync',
  getRowId,
  rowWrapper,
  loadingRowsCount = 20,
  rowHeight,
  compactRowHeight,
  centerArrows = false,
}: {
  columns: ColumnDef<T, any>[]
  data: T[]
  loading?: boolean
  error?: boolean
  loadMore?: ({ onComplete }: { onComplete?: () => void }) => void
  maxWidth?: number
  maxHeight?: number
  defaultPinnedColumns?: string[]
  forcePinning?: boolean
  v2?: boolean
  hideHeader?: boolean
  externalScrollSync?: boolean
  scrollGroup?: string
  getRowId?: (originalRow: T, index: number, parent?: Row<T>) => string
  rowWrapper?: (row: Row<T>, content: ReactNode) => ReactNode
  loadingRowsCount?: number
  rowHeight?: number
  compactRowHeight?: number
  centerArrows?: boolean
}) {
  const [loadingMore, setLoadingMore] = useState(false)
  const [showScrollRightButton, setShowScrollRightButton] = useState(false)
  const [showScrollLeftButton, setShowScrollLeftButton] = useState(false)
  const [showRightFadeOverlay, setShowRightFadeOverlay] = useState(false)
  const colors = useMemo(() => getDefaultColors(), [])
  const [pinnedColumns, setPinnedColumns] = useState<string[]>([])

  const [scrollPosition, setScrollPosition] = useState<{
    distanceFromTop: number
    distanceToBottom: number
  }>({
    distanceFromTop: 0,
    distanceToBottom: LOAD_MORE_BOTTOM_OFFSET,
  })
  const { distanceFromTop, distanceToBottom } = useDebounce(scrollPosition, 125)
  const tableBodyRef = useRef<HTMLDivElement>(null)
  const lastLoadedLengthRef = useRef(0)
  const canLoadMore = useRef(true)
  const isSticky = useMemo(() => !maxHeight, [maxHeight])

  const { parentRef, width, height, top, left } = useParentSize()

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const scrollableElement = maxHeight ? tableBodyRef.current?.parentElement : window
    if (!scrollableElement) {
      return undefined
    }
    const updateScrollPosition = () => {
      if (scrollableElement instanceof HTMLDivElement) {
        const { scrollTop, scrollHeight, clientHeight } = scrollableElement
        setScrollPosition({
          distanceFromTop: scrollTop,
          distanceToBottom: scrollHeight - scrollTop - clientHeight,
        })
      } else if (scrollableElement === window) {
        setScrollPosition({
          distanceFromTop: scrollableElement.scrollY,
          distanceToBottom: document.body.scrollHeight - scrollableElement.scrollY - scrollableElement.innerHeight,
        })
      }
    }
    scrollableElement.addEventListener('scroll', updateScrollPosition)
    return () => scrollableElement.removeEventListener('scroll', updateScrollPosition)
  }, [loadMore, maxHeight, loadingMore])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const scrollableElement = maxHeight ? tableBodyRef.current?.parentElement : window
    const shouldLoadMoreFromScroll = distanceToBottom < LOAD_MORE_BOTTOM_OFFSET
    let shouldLoadMoreFromViewportHeight = false

    if (!shouldLoadMoreFromScroll) {
      if (!maxHeight && scrollableElement === window) {
        const contentHeight = document.body.scrollHeight
        const viewportHeight = window.innerHeight
        shouldLoadMoreFromViewportHeight = contentHeight <= viewportHeight
      } else if (scrollableElement instanceof HTMLDivElement) {
        const { scrollHeight, clientHeight } = scrollableElement
        shouldLoadMoreFromViewportHeight = scrollHeight <= clientHeight
      }
    }

    if (
      (shouldLoadMoreFromScroll || shouldLoadMoreFromViewportHeight) &&
      !loadingMore &&
      loadMore &&
      canLoadMore.current &&
      !error &&
      !loading
    ) {
      setLoadingMore(true)
      setScrollPosition({
        distanceFromTop: SHOW_RETURN_TO_TOP_OFFSET,
        distanceToBottom: LOAD_MORE_BOTTOM_OFFSET,
      })
      loadMore({
        onComplete: () => {
          setLoadingMore(false)
          if (data.length === lastLoadedLengthRef.current) {
            canLoadMore.current = false
          } else {
            lastLoadedLengthRef.current = data.length
          }
        },
      })
    }
  }, [data.length, distanceFromTop, distanceToBottom, error, loadMore, loading, loadingMore, maxHeight, tableBodyRef])

  const table = useReactTable({
    columns,
    data,
    state: { columnPinning: { left: pinnedColumns } },
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const resizeHandler = () => {
      if (!defaultPinnedColumns.length) {
        return
      }

      if ((maxWidth && window.innerWidth < maxWidth) || forcePinning) {
        setPinnedColumns(defaultPinnedColumns)
      } else {
        setPinnedColumns([])
      }
    }
    resizeHandler()
    window.addEventListener('resize', resizeHandler)
    return () => {
      window.removeEventListener('resize', resizeHandler)
    }
  }, [maxWidth, defaultPinnedColumns, forcePinning, table])

  useEffect(() => {
    const container = tableBodyRef.current?.parentElement
    if (!container || loading) {
      return undefined
    }

    const horizontalScrollHandler = () => {
      const maxScrollLeft = container.scrollWidth - container.clientWidth
      const nextShowScrollRightButton = container.scrollLeft < maxScrollLeft
      if (showScrollRightButton !== nextShowScrollRightButton) {
        setShowScrollRightButton(nextShowScrollRightButton)
      }
      const nextShowScrollLeftButton = container.scrollLeft > 0
      if (showScrollLeftButton !== nextShowScrollLeftButton) {
        setShowScrollLeftButton(nextShowScrollLeftButton)
      }
      const isFullWidth = maxScrollLeft <= 0
      const isScrolledToRight = container.scrollLeft >= maxScrollLeft
      const nextShowRightFadeOverlay = pinnedColumns.length > 0 && !isFullWidth && !isScrolledToRight
      if (showRightFadeOverlay !== nextShowRightFadeOverlay) {
        setShowRightFadeOverlay(nextShowRightFadeOverlay)
      }
    }

    horizontalScrollHandler()
    container.addEventListener('scroll', horizontalScrollHandler)
    return () => {
      container.removeEventListener('scroll', horizontalScrollHandler)
    }
  }, [loading, showScrollLeftButton, showScrollRightButton, showRightFadeOverlay, pinnedColumns.length])

  const headerHeight = useMemo(() => {
    if (typeof document === 'undefined') return INTERFACE_NAV_HEIGHT
    const header = document.getElementById('AppHeader')
    return header?.clientHeight || INTERFACE_NAV_HEIGHT
  }, [])

  const scrollButtonTop = useMemo(() => {
    return calculateScrollButtonTop({
      maxHeight,
      isSticky,
      centerArrows,
      height,
      headerHeight,
    })
  }, [headerHeight, height, isSticky, maxHeight, centerArrows])

  const onScrollButtonPress = useCallback(
    (direction: ScrollButtonProps['direction']) => () => {
      const container = tableBodyRef.current?.parentElement
      if (!container) {
        return
      }

      const numPinnedVisibleColumns = table.getLeftVisibleLeafColumns().length
      const regularColumns = table.getAllColumns().slice(numPinnedVisibleColumns)
      const widths = regularColumns.map((column) => column.getSize())
      const cumulativeWidths = widths.reduce(
        (acc, current) => {
          const lastSum = acc.length > 0 ? acc[acc.length - 1] : 0
          return [...acc, lastSum + current]
        },
        [0] as number[],
      )

      if (direction === 'left') {
        cumulativeWidths.reverse()
      }

      const nextScrollLeft = cumulativeWidths.find((w) => {
        if (direction === 'left') {
          return w < container.scrollLeft
        }
        return w > container.scrollLeft
      })

      container.scrollTo({ left: nextScrollLeft, behavior: 'smooth' })
    },
    [table],
  )
  const hasPinnedColumns = useMemo(() => pinnedColumns.length > 0, [pinnedColumns])

  // Use default desktop width until measurement completes to prevent skeleton flash
  const tableSize = useMemo(() => ({ width: width || 1200, height, top, left }), [width, height, top, left])
  const computedBodyMaxHeight = useMemo(
    () => (maxHeight ? (hideHeader ? maxHeight : maxHeight - headerHeight) : undefined),
    [maxHeight, hideHeader, headerHeight],
  )

  const content = (
    <TableContainer maxWidth={maxWidth} maxHeight={maxHeight} className="relative" ref={parentRef}>
      <>
        <TableHead $isSticky={isSticky} $top={headerHeight}>
          {hasPinnedColumns && (
            <>
              <div
                className="absolute pl-3"
                style={{
                  top: scrollButtonTop,
                  left: table.getLeftTotalSize(),
                  zIndex: zIndexes.mask,
                }}
              >
                <ScrollButton
                  onPress={onScrollButtonPress('left')}
                  opacity={showScrollLeftButton ? 1 : 0}
                  direction="left"
                />
              </div>
              <div
                className="absolute pr-3"
                style={{
                  top: scrollButtonTop,
                  right: 0,
                  zIndex: zIndexes.mask,
                }}
              >
                <ScrollButton
                  onPress={onScrollButtonPress('right')}
                  opacity={showScrollRightButton ? 1 : 0}
                  direction="right"
                />
              </div>
              {(!v2 || showRightFadeOverlay) && (
                <TableScrollMask
                  top={isSticky ? 12 : 0}
                  zIndex={zIndexes.dropdown - 1}
                  right={v2 ? 0 : 1}
                  borderTopRightRadius={v2 ? '8px' : '20px'}
                />
              )}
            </>
          )}

          {!hideHeader && (
            <ScrollSyncPane group={scrollGroup}>
              <HeaderRow dimmed={!!error} v2={v2}>
                {table.getFlatHeaders().map((header) => (
                  <CellContainer
                    key={header.id}
                    style={getCommonPinningStyles({ column: header.column, colors, isHeader: true })}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </CellContainer>
                ))}
              </HeaderRow>
            </ScrollSyncPane>
          )}
        </TableHead>
        {hasPinnedColumns && (!v2 || showRightFadeOverlay) && (
          <TableScrollMask
            zIndex={zIndexes.default}
            borderBottomRightRadius={v2 ? '8px' : '20px'}
            right={v2 ? 0 : 1}
          />
        )}
      </>
      <ScrollSyncPane group={scrollGroup}>
        <TableBodyContainer maxHeight={computedBodyMaxHeight} v2={v2}>
          <TableBody
            loading={loading}
            error={error}
            v2={v2}
            rowWrapper={rowWrapper}
            loadingRowsCount={loadingRowsCount}
            rowHeight={rowHeight}
            compactRowHeight={compactRowHeight}
            // @ts-ignore
            table={table}
            ref={tableBodyRef}
          />
        </TableBodyContainer>
      </ScrollSyncPane>
      {loadingMore && (
        <LoadingIndicatorContainer>
          <LoadingIndicator>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </LoadingIndicator>
        </LoadingIndicatorContainer>
      )}
    </TableContainer>
  )

  return (
    <TableSizeProvider value={tableSize}>
      {externalScrollSync ? content : <ScrollSync horizontal>{content}</ScrollSync>}
    </TableSizeProvider>
  )
}

// Re-export components for external use
export { Cell, HeaderCell } from './Cell'
export { TableSizeProvider, useTableSize } from './TableSizeProvider'
export { ROW_HEIGHT_DESKTOP, ROW_HEIGHT_MOBILE_WEB } from './constants'
export {
  breakpoints,
  CellContainer,
  DataRow,
  HeaderRow,
  TableBodyContainer,
  TableContainer,
  TableRowLink,
  TableText,
  EllipsisText,
  HeaderArrow,
  HeaderSortText,
  ClickableHeaderRow,
  FilterHeaderRow,
} from './styled'
export { getColumnSizingStyles, getCommonPinningStyles, getDefaultColors, zIndexes, padding } from './utils'
export type { TableBodyProps } from './types'
export type { TableColors } from './utils'
