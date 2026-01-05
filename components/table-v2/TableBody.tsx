"use client"

import { CellContext, flexRender, RowData } from '@tanstack/react-table'
import { ROW_HEIGHT_DESKTOP, ROW_HEIGHT_MOBILE_WEB } from './constants'
import { CellContainer, DataRow, NoDataFoundTableRow, breakpoints } from './styled'
import { TableRow } from './TableRow'
import { useTableSize } from './TableSizeProvider'
import { TableBodyProps } from './types'
import { getColumnSizingStyles } from './utils'
import { forwardRef, useMemo, ReactNode } from 'react'

// Error modal component (simplified version)
const ErrorModal = ({ header, subtitle }: { header: React.ReactNode; subtitle: React.ReactNode }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-xl">
    <div className="text-center p-6">
      <div className="text-lg font-medium text-foreground mb-2">{header}</div>
      <div className="text-sm text-muted-foreground">{subtitle}</div>
    </div>
  </div>
)

function TableBodyInner<T extends RowData>(
  {
    table,
    loading,
    error,
    v2 = true,
    rowWrapper,
    loadingRowsCount = 20,
    rowHeight: propRowHeight,
    compactRowHeight: propCompactRowHeight,
  }: TableBodyProps<T>,
  ref: React.Ref<HTMLDivElement>,
) {
  const rows = table.getRowModel().rows
  const { width: tableWidth } = useTableSize()
  const skeletonRowHeight = useMemo(
    () =>
      tableWidth <= breakpoints.lg
        ? (propCompactRowHeight ?? ROW_HEIGHT_MOBILE_WEB)
        : (propRowHeight ?? ROW_HEIGHT_DESKTOP),
    [tableWidth, propRowHeight, propCompactRowHeight],
  )

  if (loading || error) {
    return (
      <>
        <div className="flex flex-col">
          {Array.from({ length: loadingRowsCount }, (_, rowIndex) => (
            <DataRow key={`skeleton-row-${rowIndex}`} height={skeletonRowHeight} v2={v2}>
              {table.getAllColumns().map((column, columnIndex) => (
                <CellContainer
                  key={`skeleton-row-${rowIndex}-column-${columnIndex}`}
                  style={getColumnSizingStyles(column)}
                >
                  {flexRender(column.columnDef.cell, {} as CellContext<T, any>)}
                </CellContainer>
              ))}
            </DataRow>
          ))}
        </div>
        {error && (
          <ErrorModal
            header="Error loading data"
            subtitle="Data is currently unavailable"
          />
        )}
      </>
    )
  }

  if (!rows.length) {
    return (
      <NoDataFoundTableRow className="py-5">
        <span className="text-sm text-muted-foreground">
          No data found
        </span>
      </NoDataFoundTableRow>
    )
  }

  return (
    <div ref={ref} className="flex flex-col relative">
      {rows.map((row) => (
        <TableRow<T>
          key={row.id}
          row={row}
          v2={v2}
          rowWrapper={rowWrapper}
          rowHeight={propRowHeight}
          compactRowHeight={propCompactRowHeight}
        />
      ))}
    </div>
  )
}

export const TableBody = forwardRef(TableBodyInner) as unknown as <T extends RowData>(
  p: TableBodyProps<T> & { ref?: React.Ref<HTMLDivElement> },
) => ReactNode
