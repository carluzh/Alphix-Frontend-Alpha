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
  type CurrentStepState,

  // Factory functions
  createTokenApprovalStep,
  createPermit2SignatureStep,
} from './types'

// Transaction providers (wallet-balances refresh watcher)
export { TransactionProvider } from './TransactionProvider'
export { TransactionWatcherProvider, TokenBalancesProvider } from './TokenBalancesProvider'

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

// Step orchestrator (Layer 2)
export {
  useStepExecutor,
  type StepResult,
  type StepExecutionContext,
  type StepExecutorFn,
  type UseStepExecutorConfig,
  type StepGenerationResult,
  type UseStepExecutorReturn,
} from './useStepExecutor'

