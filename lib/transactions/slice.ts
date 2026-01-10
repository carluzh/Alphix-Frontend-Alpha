/**
 * Transaction Redux Slice
 *
 * Adapted from Uniswap's transaction slice for Alphix.
 * Simplified to only include essential reducers.
 *
 * @see interface/packages/uniswap/src/features/transactions/slice.ts
 */

import { createSlice, Draft, PayloadAction } from '@reduxjs/toolkit'
import {
  ChainIdToTxIdToDetails,
  InterfaceTransactionDetails,
  TransactionStatus,
  TransactionNetworkFee,
  TransactionTypeInfo,
} from './transactionDetails'

type Address = string

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export type TransactionsState = Partial<Record<Address, ChainIdToTxIdToDetails>>

export const initialTransactionsState: TransactionsState = {}

interface TransactionId {
  chainId: number
  id: string
}

interface FinalizeParams {
  chainId: number
  id: string
  from: string
  status: TransactionStatus.Success | TransactionStatus.Failed
  hash?: string
  receipt?: {
    blockNumber: number
    blockHash: string
    transactionIndex: number
    confirmedTime: number
    gasUsed: number
    effectiveGasPrice: number
  }
  // Added for Uniswap parity - update typeInfo on finalization
  typeInfo: TransactionTypeInfo
  // Optional network fee info
  networkFee?: TransactionNetworkFee
}

const slice = createSlice({
  name: 'transactions',
  initialState: initialTransactionsState,
  reducers: {
    addTransaction: (
      state,
      { payload: transaction }: PayloadAction<InterfaceTransactionDetails>,
    ) => {
      const { chainId, id, from } = transaction
      assert(!state[from]?.[chainId]?.[id], `addTransaction: Attempted to overwrite tx with id ${id}`)
      state[from] ??= {}
      state[from]![chainId] ??= {}
      state[from]![chainId]![id] = transaction
    },

    updateTransaction: (
      state,
      { payload: transaction }: PayloadAction<InterfaceTransactionDetails>,
    ) => {
      const { chainId, id, from } = transaction
      assert(state[from]?.[chainId]?.[id], `updateTransaction: Attempted to update a missing tx with id ${id}`)
      state[from]![chainId]![id] = transaction
    },

    finalizeTransaction: (state, { payload }: PayloadAction<FinalizeParams>) => {
      const { chainId, id, from, status, hash, receipt, typeInfo, networkFee } = payload
      const tx = state[from]?.[chainId]?.[id]

      assert(tx, `finalizeTransaction: Attempted to access a missing transaction with id ${id}`)

      tx.status = status
      tx.typeInfo = typeInfo
      if (hash) {
        tx.hash = hash
      }
      if (receipt) {
        tx.receipt = receipt
      }
      if (networkFee) {
        tx.networkFee = networkFee
      }
    },

    deleteTransaction: (
      state,
      { payload: { chainId, id, address } }: PayloadAction<TransactionId & { address: string }>,
    ) => {
      assert(
        state[address]?.[chainId]?.[id],
        `deleteTransaction: Attempted to delete a tx that doesn't exist with id ${id}`,
      )
      delete state[address]![chainId]![id]
    },

    checkedTransaction: (
      state,
      {
        payload: { chainId, id, address, blockNumber },
      }: PayloadAction<{ chainId: number; id: string; address: string; blockNumber: number }>,
    ) => {
      const tx = state[address]?.[chainId]?.[id]
      // checkedTransaction is called frequently during polling, so we silently skip missing txs
      if (!tx) {
        return
      }
      if (!tx.lastCheckedBlockNumber) {
        tx.lastCheckedBlockNumber = blockNumber
      } else {
        tx.lastCheckedBlockNumber = Math.max(blockNumber, tx.lastCheckedBlockNumber)
      }
    },

    interfaceCancelTransaction: (
      state,
      {
        payload: { chainId, id, address, cancelHash },
      }: PayloadAction<{ chainId: number; id: string; address: string; cancelHash: string }>,
    ) => {
      const tx = state[address]?.[chainId]?.[id]
      assert(tx, `interfaceCancelTransaction: Attempted to cancel a missing tx with id ${id}`)
      state[address]![chainId]![id] = {
        ...tx,
        hash: cancelHash,
        status: TransactionStatus.Canceled,
      }
    },

    clearAllTransactions: (
      state,
      { payload: { chainId, address } }: PayloadAction<{ chainId: number; address: string }>,
    ) => {
      if (state[address]?.[chainId]) {
        state[address]![chainId] = {}
      }
    },
  },
})

export const {
  addTransaction,
  updateTransaction,
  finalizeTransaction,
  deleteTransaction,
  checkedTransaction,
  interfaceCancelTransaction,
  clearAllTransactions,
} = slice.actions

export const transactionReducer = slice.reducer
