/**
 * Transaction Provider
 *
 * Root provider for transaction-related cross-cutting concerns. It wraps the app
 * with the wallet-balances refresh watcher (TransactionWatcherProvider).
 *
 * The former Redux store + redux-persist layer was removed: it tracked
 * transactions that were never dispatched, so it held no state and did no work.
 * Post-tx cache invalidation is handled by lib/apollo/mutations/invalidation.ts
 * and the position-page React-Query layer.
 */

'use client'

import { PropsWithChildren } from 'react'
import { TransactionWatcherProvider } from './TokenBalancesProvider'

/**
 * Transaction Provider
 *
 * Usage:
 * ```tsx
 * <TransactionProvider>
 *   <App />
 * </TransactionProvider>
 * ```
 */
export function TransactionProvider({ children }: PropsWithChildren) {
  return <TransactionWatcherProvider>{children}</TransactionWatcherProvider>
}

export default TransactionProvider
