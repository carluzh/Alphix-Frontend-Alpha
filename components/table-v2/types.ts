import { Row, RowData, Table as TanstackTable } from '@tanstack/react-table'
import { ReactNode } from 'react'

export type TableBodyProps<T extends RowData = unknown> = {
  table: TanstackTable<T>
  loading?: boolean
  error?: boolean | Error
  v2?: boolean
  rowWrapper?: (row: Row<T>, content: ReactNode) => ReactNode
  loadingRowsCount?: number
  rowHeight?: number
  compactRowHeight?: number
}
