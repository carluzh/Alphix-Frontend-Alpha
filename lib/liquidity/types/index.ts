/**
 * Liquidity Types
 *
 * Centralized type definitions for all liquidity operations.
 */

// Position types (positionState.ts content)
export {
  // Field enum
  PositionField,
  // Fee data
  type FeeData,
  // Flow steps
  RangeAmountInputPriceMode,
  // Position state
  type PositionState,
  // Price range state
  type PriceRangeState,
  // Create position info
  type CreatePositionInfo,
  // Price range info
  type PriceRangeInfo,
  // Deposit state
  type DepositState,
  type DepositInfo,
  // Existing position info
  type V4PositionInfo,
  // Price difference
  type WarningSeverity,
  type PriceDifference,
} from './position';

// Transaction types
export {
  // Enums
  TransactionStepType,
  LiquidityTransactionType,
  // API request args types
  type CreateLPPositionRequestArgs,
  type IncreaseLPPositionRequestArgs,
  // Base transaction interfaces
  type ValidatedTransactionRequest,
  type OnChainTransactionFields,
  type SignTypedDataStepFields,
  type TokenInfo,
  type TokenCfg,
  // Step interfaces
  type TokenApprovalTransactionStep,
  type TokenRevocationTransactionStep,
  type Permit2SignatureStep,
  type Permit2TransactionStep,
  type IncreasePositionTransactionStep,
  type IncreasePositionTransactionStepAsync,
  type IncreasePositionTransactionStepBatched,
  type IncreasePositionTransactionStepBatchedAsync,
  type DecreasePositionTransactionStep,
  type CollectFeesTransactionStep,
  // Unified Yield step interfaces
  type UnifiedYieldApprovalStep,
  type UnifiedYieldDepositStep,
  type UnifiedYieldWithdrawStep,
  // Composite step types — used internally by step generators/orderers.
  type IncreaseLiquiditySteps,
  type DecreaseLiquiditySteps,
  type CollectFeesSteps,
  type TransactionStep,
  // Liquidity action (CurrencyAmount is from @uniswap/sdk-core)
  type LiquidityAction,
  // Tx and gas info
  type IncreasePositionTxAndGasInfo,
  type CreatePositionTxAndGasInfo,
  type DecreasePositionTxAndGasInfo,
  type CollectFeesTxAndGasInfo,
  type LiquidityTxAndGasInfo,
  // Validated tx context
  type ValidatedLiquidityTxContext,
  // Validation functions
  isValidLiquidityTxContext,
  // Flow state — used by useStepExecutor + executionStore
  type FlowStatus,
  type StepState,
  // Approval status
  type TokenApprovalStatus,
} from './transaction';
