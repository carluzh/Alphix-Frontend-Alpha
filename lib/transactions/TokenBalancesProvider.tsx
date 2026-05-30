/**
 * Wallet Balances Refresh Provider
 *
 * Listens for the global `walletBalancesRefresh` window event (dispatched by
 * invalidateAfterTx and TransactionModal once a transaction settles) and
 * invalidates wagmi's ['balance'] queries so on-chain balances refetch.
 *
 * This file formerly hosted a Redux-backed pending-transaction watcher. That
 * layer was inert — nothing ever dispatched a transaction into the store — so it
 * was removed. Post-tx cache invalidation is owned by
 * lib/apollo/mutations/invalidation.ts (Apollo) and the position-page
 * React-Query layer.
 *
 * @see interface/apps/web/src/state/transactions/TokenBalancesProvider.tsx
 */

'use client'

import { useQueryClient } from '@tanstack/react-query'
import { PropsWithChildren, useEffect } from 'react'

/**
 * Internal listener: invalidates wagmi balance queries whenever any flow
 * dispatches the `walletBalancesRefresh` event.
 */
function WalletBalancesRefreshListener({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const onBalanceRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['balance'] })
    }
    window.addEventListener('walletBalancesRefresh', onBalanceRefresh)
    return () => {
      window.removeEventListener('walletBalancesRefresh', onBalanceRefresh)
    }
  }, [queryClient])

  return <>{children}</>
}

/**
 * Transaction Watcher Provider
 *
 * Wraps the app so a wallet-balances refresh is triggered after transactions.
 */
export function TransactionWatcherProvider({ children }: PropsWithChildren) {
  return <WalletBalancesRefreshListener>{children}</WalletBalancesRefreshListener>
}

// Keep the old name for backward compatibility
export const TokenBalancesProvider = TransactionWatcherProvider
