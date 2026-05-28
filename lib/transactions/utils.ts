/**
 * Transaction Utils
 *
 * Utility functions for transaction status checking.
 * @see interface/apps/web/src/state/transactions/utils.ts
 */

import type { InterfaceTransactionDetails } from './transactionDetails'
import { TransactionStatus } from './transactionDetails'
import type { PendingTransactionDetails } from './types-local'

export function isPendingTx(tx: InterfaceTransactionDetails): tx is PendingTransactionDetails {
  return tx.status === TransactionStatus.Pending
}
