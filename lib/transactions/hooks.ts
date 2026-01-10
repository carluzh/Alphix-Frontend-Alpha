/**
 * Transaction Hooks
 *
 * Adapted from Uniswap's transaction hooks for Alphix.
 * Central file - kept as close to Uniswap as possible.
 *
 * @see interface/apps/web/src/state/transactions/hooks.tsx
 */

import { BigNumber } from '@ethersproject/bignumber'
import type { TransactionResponse } from '@ethersproject/providers'
import type { Token } from '@uniswap/sdk-core'
import { useAccount } from 'wagmi'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './redux-store'
import { selectTransactions } from './selectors'
import { addTransaction, deleteTransaction, interfaceCancelTransaction } from './slice'
import { isConfirmedTx, isPendingTx } from './utils'
import type {
  InterfaceTransactionDetails,
  TransactionDetails,
  TransactionTypeInfo as TransactionInfo,
  UniswapXOrderDetails,
} from './transactionDetails'
import {
  Routing,
  TransactionOriginType,
  TransactionStatus,
  TransactionType,
} from './transactionDetails'
import type { PendingTransactionDetails } from './types-local'

const ONE_MINUTE_MS = 60 * 1000

// Hooks for Redux
const useAppDispatch = () => useDispatch<AppDispatch>()
const useAppSelector = <T>(selector: (state: RootState) => T) => useSelector(selector)

// usePrevious hook
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}

// Maximum age for a pending transaction to be displayed (5 minutes)
const MAX_PENDING_TRANSACTION_AGE_MS = 5 * ONE_MINUTE_MS

// LP transaction types - module-level constant to avoid stale closures in usePendingLPTransactions
const LP_TRANSACTION_TYPES = [
  TransactionType.LiquidityIncrease,
  TransactionType.LiquidityDecrease,
  TransactionType.CreatePool,
  TransactionType.CreatePair,
  TransactionType.CollectFees,
] as const

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

export function useTransactionRemover() {
  const { address, chainId, isConnected } = useAccount()
  const dispatch = useAppDispatch()

  return useCallback(
    (hash: string) => {
      if (!isConnected || !chainId || !address) {
        return
      }

      dispatch(
        deleteTransaction({
          chainId,
          id: hash,
          address,
        }),
      )
    },
    [address, chainId, isConnected, dispatch],
  )
}

export function useTransactionCanceller() {
  const { address } = useAccount()
  const dispatch = useAppDispatch()

  return useCallback(
    ({ id, chainId, cancelHash }: { id: string; chainId: number; cancelHash: string }) => {
      if (!address) {
        return
      }
      dispatch(
        interfaceCancelTransaction({
          chainId,
          id,
          cancelHash,
          address,
        }),
      )
    },
    [dispatch, address],
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

export function useTransaction(transactionHash?: string): InterfaceTransactionDetails | undefined {
  const allTransactions = useAllTransactionsByChain()

  if (!transactionHash) {
    return undefined
  }

  return allTransactions[transactionHash]
}

export function useIsTransactionPending(transactionHash?: string): boolean {
  const transactions = useAllTransactionsByChain()

  if (!transactionHash || !transactions[transactionHash]) {
    return false
  }

  return isPendingTx(transactions[transactionHash])
}

export function useIsTransactionConfirmed(transactionHash?: string): boolean {
  const transactions = useAllTransactionsByChain()

  if (!transactionHash || !transactions[transactionHash]) {
    return false
  }

  return isConfirmedTx(transactions[transactionHash])
}

/**
 * Returns whether a transaction happened in the last day (86400 seconds * 1000 milliseconds / second)
 * @param tx to check for recency
 */
function isTransactionRecent(tx: TransactionDetails): boolean {
  return new Date().getTime() - tx.addedTime < 86_400_000
}

function usePendingApprovalAmount(token?: Token, spender?: string): BigNumber | undefined {
  const allTransactions = useAllTransactionsByChain()
  return useMemo(() => {
    if (typeof token?.address !== 'string' || typeof spender !== 'string') {
      return undefined
    }

    // eslint-disable-next-line guard-for-in
    for (const txHash in allTransactions) {
      const tx = allTransactions[txHash]
      if (!tx || isConfirmedTx(tx) || tx.typeInfo.type !== TransactionType.Approve) {
        continue
      }
      if (
        tx.typeInfo.spender === spender &&
        tx.typeInfo.tokenAddress === token.address &&
        isTransactionRecent(tx) &&
        tx.typeInfo.approvalAmount !== undefined
      ) {
        return BigNumber.from(tx.typeInfo.approvalAmount)
      }
    }
    return undefined
  }, [allTransactions, spender, token?.address])
}

// returns whether a token has a pending approval transaction
export function useHasPendingApproval(token?: Token, spender?: string): boolean {
  return usePendingApprovalAmount(token, spender)?.gt(0) ?? false
}

export function useHasPendingRevocation(token?: Token, spender?: string): boolean {
  return usePendingApprovalAmount(token, spender)?.eq(0) ?? false
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

function usePendingLPTransactions(): PendingTransactionDetails[] {
  const allTransactions = useAllTransactionsByChain()
  const { address } = useAccount()

  return useMemo(
    () =>
      Object.values(allTransactions).filter(
        (tx): tx is PendingTransactionDetails =>
          tx.from === address &&
          isPendingTx(tx) &&
          (LP_TRANSACTION_TYPES as readonly TransactionType[]).includes(tx.typeInfo.type),
      ),
    [address, allTransactions],
  )
}

export function usePendingLPTransactionsChangeListener(callback: () => void) {
  const pendingLPTransactions = usePendingLPTransactions()
  const previousPendingCount = usePrevious(pendingLPTransactions.length)
  useEffect(() => {
    if (previousPendingCount !== undefined && pendingLPTransactions.length !== previousPendingCount) {
      callback()
    }
  }, [pendingLPTransactions.length, callback, previousPendingCount])
}
