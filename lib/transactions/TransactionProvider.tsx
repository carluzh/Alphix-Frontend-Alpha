/**
 * Transaction Provider
 *
 * Root provider for transaction infrastructure.
 * Combines Redux store for transaction state and TransactionWatcher for cache invalidation.
 *
 * @see interface/apps/web/src/state/index.ts
 */

'use client'

import { PropsWithChildren } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { store, persistor } from './redux-store'
import { TransactionWatcherProvider } from './TokenBalancesProvider'

/**
 * Transaction Provider
 *
 * Wraps the app with:
 * 1. Redux store for transaction state persistence
 * 2. TransactionWatcher for detecting completed transactions
 *
 * Usage:
 * ```tsx
 * <TransactionProvider>
 *   <App />
 * </TransactionProvider>
 * ```
 */
export function TransactionProvider({ children }: PropsWithChildren) {
  return (
    <ReduxProvider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <TransactionWatcherProvider>{children}</TransactionWatcherProvider>
      </PersistGate>
    </ReduxProvider>
  )
}

export default TransactionProvider
