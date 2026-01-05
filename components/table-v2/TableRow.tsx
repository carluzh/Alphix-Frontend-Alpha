"use client"

import { Cell, flexRender, Row, RowData } from '@tanstack/react-table'
import { ROW_HEIGHT_DESKTOP, ROW_HEIGHT_MOBILE_WEB } from './constants'
import { CellContainer, DataRow, TableRowLink, breakpoints } from './styled'
import { useTableSize } from './TableSizeProvider'
import { getCommonPinningStyles, getDefaultColors, TableColors } from './utils'
import { memo, useMemo, ReactNode } from 'react'

interface TableCellProps<T extends RowData> {
  cell: Cell<T, unknown>
  colors: TableColors
  v2?: boolean
}

function TableCellComponent<T extends RowData>({ cell, colors, v2 = true }: TableCellProps<T>): ReactNode {
  const isPinned = cell.column.getIsPinned()
  const isFirstPinnedColumn = isPinned && cell.column.getIsFirstColumn('left')
  const pinnedStyles = getCommonPinningStyles({ column: cell.column, colors, isHeader: false })

  return (
    <CellContainer
      style={pinnedStyles}
      className={v2 && isFirstPinnedColumn ? "rounded-tl-xl rounded-bl-xl" : undefined}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </CellContainer>
  )
}

const TableCell = memo(TableCellComponent) as typeof TableCellComponent

interface TableRowProps<T extends RowData> {
  row: Row<T>
  v2: boolean
  rowWrapper?: (row: Row<T>, content: ReactNode) => ReactNode
  rowHeight?: number
  compactRowHeight?: number
}

function TableRowComponent<T extends RowData>({
  row,
  v2 = true,
  rowWrapper,
  rowHeight: propRowHeight,
  compactRowHeight: propCompactRowHeight,
}: TableRowProps<T>): ReactNode {
  const rowOriginal = row.original as {
    link?: string
    linkState?: unknown
    testId?: string
  }
  const colors = useMemo(() => getDefaultColors(), [])
  const { width: tableWidth } = useTableSize()
  const rowHeight = useMemo(
    () =>
      tableWidth <= breakpoints.lg
        ? (propCompactRowHeight ?? ROW_HEIGHT_MOBILE_WEB)
        : (propRowHeight ?? ROW_HEIGHT_DESKTOP),
    [tableWidth, propCompactRowHeight, propRowHeight],
  )
  const cells = row
    .getVisibleCells()
    .map((cell: Cell<T, unknown>) => <TableCell<T> key={cell.id} cell={cell} colors={colors} v2={v2} />)

  const rowContent = (
    <div className="group">
      {rowOriginal.link ? (
        <TableRowLink href={rowOriginal.link} data-testid={rowOriginal.testId}>
          <DataRow height={rowHeight} v2={v2}>
            {cells}
          </DataRow>
        </TableRowLink>
      ) : (
        <DataRow height={rowHeight} data-testid={rowOriginal.testId} v2={v2}>
          {cells}
        </DataRow>
      )}
    </div>
  )
  return rowWrapper ? rowWrapper(row, rowContent) : rowContent
}

export const TableRow = memo(TableRowComponent) as typeof TableRowComponent
