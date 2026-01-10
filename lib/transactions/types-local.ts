/**
 * Local Transaction Types
 *
 * Web-specific types for Alphix transaction handling.
 * @see interface/apps/web/src/state/transactions/types.ts
 */

import type { InterfaceTransactionDetails, TransactionStatus } from './transactionDetails'

// Web-specific pending transaction details with guaranteed pending status
export type PendingTransactionDetails = InterfaceTransactionDetails & {
  status: TransactionStatus.Pending
  lastCheckedBlockNumber?: number
  deadline?: number
}

// Web-specific confirmed transaction details
export type ConfirmedTransactionDetails = InterfaceTransactionDetails & {
  status: TransactionStatus.Success | TransactionStatus.Failed
}
