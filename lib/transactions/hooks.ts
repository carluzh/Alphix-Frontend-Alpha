/**
 * Transaction Hooks
 *
 * Adapted from Uniswap's transaction hooks for Alphix.
 * Central file - kept as close to Uniswap as possible.
 *
 * @see interface/apps/web/src/state/transactions/hooks.tsx
 */

import type { TransactionResponse } from '@ethersproject/providers'
import { useAccount } from 'wagmi'
import { useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './redux-store'
import { selectTransactions } from './selectors'
import { addTransaction } from './slice'
import { isPendingTx } from './utils'
import type {
  InterfaceTransactionDetails,
  TransactionDetails,
  TransactionTypeInfo as TransactionInfo,
} from './transactionDetails'
import {
  Routing,
  TransactionOriginType,
  TransactionStatus,
} from './transactionDetails'
import type { PendingTransactionDetails } from './types-local'

const ONE_MINUTE_MS = 60 * 1000

// Hooks for Redux
const useAppDispatch = () => useDispatch<AppDispatch>()
const useAppSelector = <T>(selector: (state: RootState) => T) => useSelector(selector)

// Maximum age for a pending transaction to be displayed (5 minutes)
const MAX_PENDING_TRANSACTION_AGE_MS = 5 * ONE_MINUTE_MS

// helper that can take a ethers library transaction response and add it to the list of transactions
export function useTransactionAdder(): (
  response: TransactionResponse,
  info: TransactionInfo,
  deadline?: number,
) => void {
  const { address, chainId, isConnected } = useAccount()
  const dispatch = useAppDispatch()

  return useCallback(
    (response: TransactionResponse, info: TransactionInfo, deadline?: number) => {
      if (!isConnected || !chainId || !address) {
        return
      }

      const { hash } = response
      if (!hash) {
        throw Error('No transaction hash found.')
      }

      // Create a classic transaction details object
      const transaction: InterfaceTransactionDetails = {
        id: hash,
        hash,
        from: address,
        typeInfo: info,
        chainId: response.chainId || chainId,
        routing: Routing.CLASSIC,
        transactionOriginType: TransactionOriginType.Internal,
        status: TransactionStatus.Pending,
        addedTime: Date.now(),
        deadline,
        ownerAddress: address,
        options: {
          request: {
            to: response.to,
            from: response.from,
            data: response.data,
            value: response.value,
            gasLimit: response.gasLimit,
            gasPrice: response.gasPrice,
            nonce: response.nonce,
            chainId: response.chainId,
          },
        },
      }

      dispatch(addTransaction(transaction))
    },
    [address, chainId, isConnected, dispatch],
  )
}

// returns all the transactions for the current chain
function useAllTransactionsByChain(): { [txHash: string]: InterfaceTransactionDetails } {
  const { address, chainId } = useAccount()
  const state = useAppSelector(selectTransactions)

  return useMemo(() => {
    if (!address || chainId === undefined) {
      return {}
    }
    return state[address]?.[chainId] ?? {}
  }, [address, chainId, state])
}

function isPendingTransactionRecent(tx: TransactionDetails): boolean {
  return Date.now() - tx.addedTime < MAX_PENDING_TRANSACTION_AGE_MS
}

/**
 * Returns pending transactions that are less than MAX_PENDING_TRANSACTION_AGE_MS old.
 * Note: The age filter is evaluated on re-render, not in real-time. Transactions won't
 * automatically disappear after 5 minutes - they'll be filtered on the next re-render
 * triggered by user interaction or state changes. This is intentional to avoid
 * unnecessary polling/timer complexity.
 */
export function usePendingTransactions(): PendingTransactionDetails[] {
  const allTransactions = useAllTransactionsByChain()
  const { address } = useAccount()

  return useMemo(
    () =>
      Object.values(allTransactions).filter(
        (tx): tx is PendingTransactionDetails =>
          tx.from === address && isPendingTx(tx) && isPendingTransactionRecent(tx),
      ),
    [address, allTransactions],
  )
}

