import { ParentSizeState } from '@visx/responsive/lib/hooks/useParentSize'
import { createContext, useContext } from 'react'

// Default to desktop width to prevent skeleton flash (32px -> 16px) on initial render
const TableSizeContext = createContext<ParentSizeState>({ width: 1200, height: 0, top: 0, left: 0 })

export const useTableSize = () => {
  return useContext(TableSizeContext)
}

export function TableSizeProvider({ children, value }: { children: React.ReactNode; value: ParentSizeState }) {
  return <TableSizeContext.Provider value={value}>{children}</TableSizeContext.Provider>
}
