/**
 * Transaction Store
 *
 * Zustand store for tracking pending transactions.
 * Adapted from Uniswap's Redux slice pattern.
 *
 * @see interface/packages/uniswap/src/features/transactions/slice.ts
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// =============================================================================
// TYPES
// =============================================================================

export enum TransactionType {
  // Liquidity operations
  AddLiquidity = 'ADD_LIQUIDITY',
  IncreaseLiquidity = 'INCREASE_LIQUIDITY',
  DecreaseLiquidity = 'DECREASE_LIQUIDITY',
  CollectFees = 'COLLECT_FEES',

  // Swap operations
  Swap = 'SWAP',

  // Approval operations
  Approve = 'APPROVE',
}

export enum TransactionStatus {
  Pending = 'PENDING',
  Success = 'SUCCESS',
  Failed = 'FAILED',
}

export interface TransactionTokenInfo {
  symbol: string
  address: string
  amount?: string
  decimals?: number
}

export interface TransactionDetails {
  /** Unique transaction hash (also serves as ID) */
  id: string
  hash: `0x${string}`

  /** Type of transaction */
  type: TransactionType

  /** Current status */
  status: TransactionStatus

  /** Chain ID where transaction was submitted */
  chainId: number

  /** User address that initiated the transaction */
  from: string

  /** Timestamp when transaction was submitted */
  addedTime: number

  /** Token 0 info (for LP operations) */
  token0?: TransactionTokenInfo

  /** Token 1 info (for LP operations) */
  token1?: TransactionTokenInfo

  /** Pool ID (for LP operations) */
  poolId?: string

  /** Position ID (for existing position operations) */
  positionId?: string

  /** Tick bounds (for LP operations) */
  tickLower?: number
  tickUpper?: number

  /** TVL delta for optimistic updates */
  tvlDelta?: number

  /** Block number when confirmed */
  blockNumber?: number

  /** Last checked block number */
  lastCheckedBlockNumber?: number

  /** Error message if failed */
  errorMessage?: string

  /** Receipt data */
  receipt?: {
    blockNumber: number
    confirmedTime: number
    gasUsed: number
  }
}

export type PendingTransactionDetails = TransactionDetails & {
  status: TransactionStatus.Pending
}

// State shape: { [address]: { [chainId]: { [txHash]: TransactionDetails } } }
type TransactionsState = {
  transactions: Record<string, Record<number, Record<string, TransactionDetails>>>
}

type TransactionsActions = {
  addTransaction: (tx: TransactionDetails) => void
  updateTransaction: (tx: Partial<TransactionDetails> & { id: string; from: string; chainId: number }) => void
  finalizeTransaction: (params: {
    id: string
    from: string
    chainId: number
    status: TransactionStatus.Success | TransactionStatus.Failed
    blockNumber?: number
    receipt?: TransactionDetails['receipt']
    errorMessage?: string
  }) => void
  deleteTransaction: (params: { id: string; from: string; chainId: number }) => void
  clearAllTransactions: (params: { from: string; chainId: number }) => void
  getTransaction: (params: { id: string; from: string; chainId: number }) => TransactionDetails | undefined
}

// =============================================================================
// STORE
// =============================================================================

export const useTransactionStore = create<TransactionsState & TransactionsActions>()(
  persist(
    (set, get) => ({
      transactions: {},

      addTransaction: (tx) => {
        set((state) => {
          const { from, chainId, id } = tx

          // Don't overwrite existing transactions
          if (state.transactions[from]?.[chainId]?.[id]) {
            console.warn(`[TransactionStore] Attempted to overwrite tx with id ${id}`)
            return state
          }

          return {
            transactions: {
              ...state.transactions,
              [from]: {
                ...state.transactions[from],
                [chainId]: {
                  ...state.transactions[from]?.[chainId],
                  [id]: tx,
                },
              },
            },
          }
        })
      },

      updateTransaction: (update) => {
        set((state) => {
          const { id, from, chainId, ...rest } = update
          const existing = state.transactions[from]?.[chainId]?.[id]

          if (!existing) {
            console.warn(`[TransactionStore] Attempted to update missing tx with id ${id}`)
            return state
          }

          return {
            transactions: {
              ...state.transactions,
              [from]: {
                ...state.transactions[from],
                [chainId]: {
                  ...state.transactions[from]?.[chainId],
                  [id]: { ...existing, ...rest },
                },
              },
            },
          }
        })
      },

      finalizeTransaction: ({ id, from, chainId, status, blockNumber, receipt, errorMessage }) => {
        set((state) => {
          const existing = state.transactions[from]?.[chainId]?.[id]

          if (!existing) {
            console.warn(`[TransactionStore] Attempted to finalize missing tx with id ${id}`)
            return state
          }

          return {
            transactions: {
              ...state.transactions,
              [from]: {
                ...state.transactions[from],
                [chainId]: {
                  ...state.transactions[from]?.[chainId],
                  [id]: {
                    ...existing,
                    status,
                    blockNumber,
                    receipt,
                    errorMessage,
                  },
                },
              },
            },
          }
        })
      },

      deleteTransaction: ({ id, from, chainId }) => {
        set((state) => {
          const chainTxs = state.transactions[from]?.[chainId]
          if (!chainTxs || !chainTxs[id]) {
            return state
          }

          const { [id]: _, ...rest } = chainTxs
          return {
            transactions: {
              ...state.transactions,
              [from]: {
                ...state.transactions[from],
                [chainId]: rest,
              },
            },
          }
        })
      },

      clearAllTransactions: ({ from, chainId }) => {
        set((state) => ({
          transactions: {
            ...state.transactions,
            [from]: {
              ...state.transactions[from],
              [chainId]: {},
            },
          },
        }))
      },

      getTransaction: ({ id, from, chainId }) => {
        return get().transactions[from]?.[chainId]?.[id]
      },
    }),
    {
      name: 'alphix-transactions',
      partialize: (state) => ({ transactions: state.transactions }),
    }
  )
)

// =============================================================================
// SELECTORS
// =============================================================================

export function selectTransactionsByAddressAndChain(
  state: TransactionsState,
  address: string,
  chainId: number
): Record<string, TransactionDetails> {
  return state.transactions[address]?.[chainId] ?? {}
}

export function selectAllTransactionsForAddress(
  state: TransactionsState,
  address: string
): TransactionDetails[] {
  const addressTxs = state.transactions[address]
  if (!addressTxs) return []

  return Object.values(addressTxs).flatMap((chainTxs) => Object.values(chainTxs))
}

export function isPendingTx(tx: TransactionDetails): tx is PendingTransactionDetails {
  return tx.status === TransactionStatus.Pending
}

export function isConfirmedTx(tx: TransactionDetails): boolean {
  return tx.status === TransactionStatus.Success || tx.status === TransactionStatus.Failed
}
