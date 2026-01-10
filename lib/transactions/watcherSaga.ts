/**
 * Transaction Watcher
 *
 * Adapted from Uniswap's watcherSaga for Alphix.
 * Simplified to use React Query instead of Redux Saga.
 *
 * Implements Uniswap's 2-layer cache invalidation:
 * - Layer 1: Immediate invalidation (React Query + Apollo)
 * - Layer 2: Delayed refetch (3s) for blockchain state propagation
 *
 * @see interface/apps/web/src/state/sagas/transactions/watcherSaga.ts
 */

import { QueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { PendingTransactionDetails } from './types-local'
import { TransactionType } from './transactionDetails'
import { apolloClient } from '@/lib/apollo/client'

type WatchTransactionsCallbackParams = {
  pendingDiff: PendingTransactionDetails[]
  address: string
  chainId: number
  queryClient: QueryClient
}

type WatchTransactionsCallback = (params: WatchTransactionsCallbackParams) => void

// Delay for refetching to allow blockchain state to propagate
const REFETCH_DELAY_MS = 3000

// Store active timeouts for cleanup
const activeTimeouts = new Set<ReturnType<typeof setTimeout>>()

/**
 * Determines which query keys to invalidate based on transaction type
 */
function getQueryKeysToInvalidate(typeInfo: PendingTransactionDetails['typeInfo']): string[] {
  const keys: string[] = []

  switch (typeInfo.type) {
    case TransactionType.Swap:
      keys.push('tokenBalances', 'positions')
      break
    case TransactionType.LiquidityIncrease:
    case TransactionType.LiquidityDecrease:
    case TransactionType.CreatePool:
    case TransactionType.CreatePair:
      keys.push('positions', 'tokenBalances', 'poolData')
      break
    case TransactionType.CollectFees:
      keys.push('positions', 'tokenBalances', 'feesEarned')
      break
    case TransactionType.Approve:
    case TransactionType.Permit2Approve:
      keys.push('tokenAllowances')
      break
    case TransactionType.Wrap:
      keys.push('tokenBalances')
      break
    default:
      keys.push('tokenBalances')
  }

  return keys
}

/**
 * Invalidates Apollo cache for active queries.
 * Called alongside React Query invalidation for full cache consistency.
 */
function invalidateApolloCache(): void {
  try {
    // Refetch all active Apollo queries (same as Uniswap pattern)
    apolloClient.refetchQueries({ include: 'active' })
  } catch (error) {
    // Apollo client may not be initialized in SSR - safe to ignore
    console.debug('[TransactionWatcher] Apollo refetch skipped:', error)
  }
}

/**
 * Watches completed transactions and triggers cache invalidation.
 * Uses a 2-layer approach:
 * - Layer 1: Immediate invalidation for optimistic updates
 * - Layer 2: Delayed refetch for blockchain state propagation
 *
 * Returns a cleanup function to clear pending timeouts.
 */
export function watchTransactions(params: WatchTransactionsCallbackParams): () => void {
  const { pendingDiff, queryClient } = params

  if (!pendingDiff.length) {
    return () => {}
  }

  // Collect all query keys to invalidate
  const keysToInvalidate = new Set<string>()

  for (const tx of pendingDiff) {
    const keys = getQueryKeysToInvalidate(tx.typeInfo)
    keys.forEach((key) => keysToInvalidate.add(key))
  }

  // Layer 1: Immediate invalidation (React Query + Apollo)
  keysToInvalidate.forEach((key) => {
    queryClient.invalidateQueries({ queryKey: [key] })
  })
  invalidateApolloCache()

  // Layer 2: Delayed refetch for blockchain state propagation
  const timeoutId = setTimeout(() => {
    activeTimeouts.delete(timeoutId)
    keysToInvalidate.forEach((key) => {
      queryClient.invalidateQueries({ queryKey: [key] })
    })
    invalidateApolloCache()
  }, REFETCH_DELAY_MS)

  activeTimeouts.add(timeoutId)

  // Return cleanup function
  return () => {
    clearTimeout(timeoutId)
    activeTimeouts.delete(timeoutId)
  }
}

/**
 * Clears all active timeouts. Call on unmount.
 */
export function clearAllWatcherTimeouts(): void {
  activeTimeouts.forEach((timeoutId) => {
    clearTimeout(timeoutId)
  })
  activeTimeouts.clear()
}

type WatchTransactionsCallbackWithCleanup = (params: WatchTransactionsCallbackParams) => () => void

/**
 * Hook to get a callback for watching transactions.
 * Call this when pending transactions are detected as completed.
 * Returns the cleanup function from watchTransactions.
 */
export function useWatchTransactionsCallback(): WatchTransactionsCallbackWithCleanup {
  return useCallback((params) => {
    return watchTransactions(params)
  }, [])
}
