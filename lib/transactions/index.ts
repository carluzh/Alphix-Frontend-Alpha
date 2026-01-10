/**
 * Transaction Types & Utilities - Barrel exports
 *
 * Types and step builders for multi-step transaction flows
 * Adapted from Uniswap's transaction step system
 */

// Step status enum
export { StepStatus } from './step-status'

// Types and step builders
export {
  // Enums
  TransactionStepType,

  // Step interfaces
  type TransactionStepBase,
  type TokenApprovalStep,
  type Permit2SignatureStep,
  type LiquidityPositionStep,
  type TransactionStep,

  // Props interfaces
  type StepRowProps,
  type CurrentStepState,

  // Config interfaces
  type AddLiquidityStepsConfig,
  type IncreaseLiquidityStepsConfig,
  type DecreaseLiquidityStepsConfig,

  // Factory functions
  createTokenApprovalStep,
  createPermit2SignatureStep,
  createLiquidityStep,

  // Step builders
  buildAddLiquiditySteps,
  buildIncreaseLiquiditySteps,
  buildDecreaseLiquiditySteps,
} from './types'

// Transaction state management (Redux)
export { TransactionProvider } from './TransactionProvider'
export { TransactionWatcherProvider, TokenBalancesProvider } from './TokenBalancesProvider'

// Transaction hooks
export {
  useTransactionAdder,
  useTransactionRemover,
  useTransactionCanceller,
  useTransaction,
  useIsTransactionPending,
  useIsTransactionConfirmed,
  usePendingTransactions,
  useHasPendingApproval,
  useHasPendingRevocation,
  usePendingLPTransactionsChangeListener,
} from './hooks'

// Re-export TradeType from @uniswap/sdk-core for swap transaction info
export { TradeType } from '@uniswap/sdk-core'

// Transaction types
export {
  TransactionStatus,
  TransactionType,
  TransactionOriginType,
  Routing,
  type InterfaceTransactionDetails,
  type TransactionDetails,
  type TransactionTypeInfo,
  type LiquidityIncreaseTransactionInfo,
  type LiquidityDecreaseTransactionInfo,
  type ExactInputSwapTransactionInfo,
  type ExactOutputSwapTransactionInfo,
  type ApproveTransactionInfo,
  type Permit2ApproveTransactionInfo,
} from './transactionDetails'

// Local types
export type { PendingTransactionDetails, ConfirmedTransactionDetails } from './types-local'

// Redux store (for advanced usage)
export { store as transactionStore, persistor as transactionPersistor } from './redux-store'
export type { RootState as TransactionRootState, AppDispatch as TransactionAppDispatch } from './redux-store'
