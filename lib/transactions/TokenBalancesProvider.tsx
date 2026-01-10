/**
 * Transaction Watcher Provider
 *
 * Adapted from Uniswap's TokenBalancesProvider for Alphix.
 * Watches pending transactions and triggers cache invalidation when they complete.
 *
 * @see interface/apps/web/src/state/transactions/TokenBalancesProvider.tsx
 */

'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react'
import { usePendingTransactions } from './hooks'
import { useWatchTransactionsCallback, clearAllWatcherTimeouts } from './watcherSaga'
import type { PendingTransactionDetails } from './types-local'

// usePrevious hook
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}

/**
 * Internal provider that watches for transaction completion.
 * Detects when pending transactions are no longer pending (pendingDiff)
 * and triggers cache invalidation.
 */
function TransactionWatcherInternal({ children }: PropsWithChildren) {
  const { address, chainId } = useAccount()
  const queryClient = useQueryClient()

  // Get current pending transactions
  const pendingTransactions = usePendingTransactions()
  const prevPendingTransactions = usePrevious(pendingTransactions)

  // Calculate which transactions are no longer pending (completed)
  const pendingDiff = useMemo(
    () =>
      prevPendingTransactions?.filter(
        (tx) => !pendingTransactions.some((current) => current.id === tx.id)
      ) ?? [],
    [pendingTransactions, prevPendingTransactions]
  )

  // Get the watcher callback
  const watchTransactions = useWatchTransactionsCallback()

  // Store cleanup functions for active watchers
  const cleanupRef = useRef<(() => void) | null>(null)

  // Trigger cache invalidation when transactions complete
  useEffect(() => {
    if (!address || !chainId) {
      return
    }

    if (!pendingDiff.length) {
      return
    }

    console.log('[TransactionWatcher] Detected completed transactions:', pendingDiff.length)

    // Clean up any previous watcher before starting new one
    if (cleanupRef.current) {
      cleanupRef.current()
    }

    const cleanup = watchTransactions({
      address,
      chainId,
      pendingDiff,
      queryClient,
    })

    cleanupRef.current = cleanup

    return cleanup
  }, [pendingDiff, address, chainId, watchTransactions, queryClient])

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
      }
      clearAllWatcherTimeouts()
    }
  }, [])

  return <>{children}</>
}

/**
 * Transaction Watcher Provider
 *
 * Wraps the app to automatically detect completed transactions
 * and trigger cache invalidation for relevant data.
 *
 * Uses Uniswap's 2-layer cache invalidation:
 * - Layer 1: Immediate invalidation for optimistic updates
 * - Layer 2: Delayed refetch (3s) for blockchain state propagation
 */
export function TransactionWatcherProvider({ children }: PropsWithChildren) {
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    setInitialized(true)
  }, [])

  // Wait for hydration to avoid SSR issues
  if (!initialized) {
    return <>{children}</>
  }

  return <TransactionWatcherInternal>{children}</TransactionWatcherInternal>
}

// Keep the old name for backward compatibility
export const TokenBalancesProvider = TransactionWatcherProvider
