/**
 * Transaction Selectors
 *
 * Redux selectors for transaction state.
 * @see interface/packages/uniswap/src/features/transactions/selectors.ts
 */

import type { TransactionsState } from './slice'
import type { RootState } from './redux-store'

export const selectTransactions = (state: RootState): TransactionsState => state.transactions ?? {}
