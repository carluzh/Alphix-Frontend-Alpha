/**
 * Transaction Utils
 *
 * Utility functions for transaction status checking.
 * @see interface/apps/web/src/state/transactions/utils.ts
 */

import type { InterfaceTransactionDetails } from './transactionDetails'
import { TransactionStatus } from './transactionDetails'
import type { PendingTransactionDetails, ConfirmedTransactionDetails } from './types-local'

export function isPendingTx(tx: InterfaceTransactionDetails): tx is PendingTransactionDetails {
  return tx.status === TransactionStatus.Pending
}

export function isConfirmedTx(tx: InterfaceTransactionDetails): tx is ConfirmedTransactionDetails {
  return (
    (tx.status === TransactionStatus.Success || tx.status === TransactionStatus.Failed) &&
    !!tx.receipt?.confirmedTime
  )
}
