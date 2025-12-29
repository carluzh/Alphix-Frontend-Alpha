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
  DEFAULT_FEE_DATA,
  // Flow steps
  PositionFlowStep,
  RangeAmountInputPriceMode,
  // Position state
  type InitialPosition,
  type PositionState,
  DEFAULT_POSITION_STATE,
  // Price range state
  type PriceRangeState,
  DEFAULT_PRICE_RANGE_STATE,
  // Create position info
  type CreatePositionInfo,
  // Price range info
  type PriceRangeInfo,
  // Deposit state
  type DepositState,
  DEFAULT_DEPOSIT_STATE,
  type DepositInfo,
  // Existing position info
  type V4PositionInfo,
  // Price difference
  type WarningSeverity,
  type PriceDifference,
  type DynamicFeeTierSpeedbumpData,
} from './position';

// Transaction types
export {
  // Enums
  TransactionStepType,
  LiquidityTransactionType,
  // API request args types
  type CreateLPPositionRequestArgs,
  type IncreaseLPPositionRequestArgs,
  type LPPositionTransactionResponse,
  // Base transaction interfaces
  type ValidatedTransactionRequest,
  type OnChainTransactionFields,
  type OnChainTransactionFieldsBatched,
  type SignTypedDataStepFields,
  type TokenInfo,
  // Step interfaces
  type TokenApprovalTransactionStep,
  type TokenRevocationTransactionStep,
  type Permit2SignatureStep,
  type Permit2TransactionStep,
  type IncreasePositionTransactionStep,
  type IncreasePositionTransactionStepAsync,
  type IncreasePositionTransactionStepBatched,
  type DecreasePositionTransactionStep,
  type CollectFeesTransactionStep,
  // Composite step types
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
  type ValidatedIncreasePositionTxAndGasInfo,
  type ValidatedCreatePositionTxAndGasInfo,
  type ValidatedDecreasePositionTxAndGasInfo,
  type ValidatedCollectFeesTxAndGasInfo,
  type ValidatedLiquidityTxContext,
  // Validation functions
  isValidLiquidityTxContext,
  // Flow state
  type FlowStatus,
  type StepState,
  type LiquidityFlowState,
  // Approval status
  type TokenApprovalStatus,
  type ApprovalCheckResult,
  // Stepper UI
  type StepperStep,
} from './transaction';
