/**
 * Transaction Selectors
 *
 * Redux selectors for transaction state.
 * @see interface/packages/uniswap/src/features/transactions/selectors.ts
 */

import type { TransactionsState } from './slice'

export interface RootState {
  transactions: TransactionsState
}

export const selectTransactions = (state: RootState): TransactionsState => state.transactions
