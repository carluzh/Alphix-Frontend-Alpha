/**
 * Unified Liquidity Module
 *
 * Organized following Uniswap's structure:
 * - types/        Type definitions
 * - hooks/        Custom React hooks
 * - utils/        Pure utility functions
 * - transaction/  Transaction builders and steps
 */

// TYPES - Selective exports (matching Uniswap pattern, no export *)
export { PositionField, type FeeData, DEFAULT_FEE_DATA, PositionFlowStep, RangeAmountInputPriceMode, type InitialPosition, type PositionState, DEFAULT_POSITION_STATE, type PriceRangeState, DEFAULT_PRICE_RANGE_STATE, type CreatePositionInfo, type PriceRangeInfo, type DepositState, DEFAULT_DEPOSIT_STATE, type DepositInfo, type V4PositionInfo, type WarningSeverity, type PriceDifference, type DynamicFeeTierSpeedbumpData } from './types/position';
export { TransactionStepType, LiquidityTransactionType, type ValidatedTransactionRequest, type OnChainTransactionFields, type OnChainTransactionFieldsBatched, type SignTypedDataStepFields, type TokenInfo, type TokenApprovalTransactionStep, type TokenRevocationTransactionStep, type Permit2SignatureStep, type Permit2TransactionStep, type IncreasePositionTransactionStep, type IncreasePositionTransactionStepAsync, type IncreasePositionTransactionStepBatched, type DecreasePositionTransactionStep, type CollectFeesTransactionStep, type IncreaseLiquiditySteps, type DecreaseLiquiditySteps, type CollectFeesSteps, type TransactionStep, type LiquidityAction, type IncreasePositionTxAndGasInfo, type CreatePositionTxAndGasInfo, type DecreasePositionTxAndGasInfo, type CollectFeesTxAndGasInfo, type LiquidityTxAndGasInfo, type ValidatedLiquidityTxContext, isValidLiquidityTxContext, type FlowStatus, type StepState, type LiquidityFlowState, type TokenApprovalStatus, type ApprovalCheckResult, type StepperStep } from './types/transaction';

// =============================================================================
// HOOKS - Custom React hooks for liquidity operations
// =============================================================================

// Position hooks
export {
  useDerivedPositionInfo,
  useDerivedPositionInfoFromState,
  getFeeDataFromPool,
  type UseDerivedPositionInfoParams,
} from './hooks/position';

// Approval hooks
export {
  useLiquidityApprovals,
  useCheckMintApprovals,
  useCheckIncreaseApprovals,
  type UseApprovalsParams,
  type UseApprovalsOptions,
  type UseApprovalsResult,
  type CheckMintApprovalsParams,
  type CheckIncreaseApprovalsParams,
  type LegacyApprovalResponse,
  // Mode-aware approval hook (supports both V4 and Unified Yield)
  useModeAwareApprovals,
  useCheckMintApprovalsWithMode,
  type UseModeAwareApprovalsParams,
  type UseModeAwareApprovalsOptions,
  type UseModeAwareApprovalsResult,
  type ModeAwareApprovalResult,
} from './hooks/approval';

// Range hooks - SDK-based tick limit and range utilities
export {
  Bound,
  getIsTickAtLimit,
  isFullRangePosition,
} from './hooks/range';


// Gas fee estimation hooks
export {
  useGasFeeEstimate,
  type GasFeeEstimateResult,
  type UseGasFeeEstimateParams,
} from './hooks/useGasFeeEstimate';

// Transaction preparation hooks
export {
  usePrepareMintQuery,
  type PrepareMintQueryParams,
  type PrepareMintQueryResult,
} from './hooks/usePrepareMintQuery';

// =============================================================================
// UTILITIES - Pure functions for calculations and validation
// =============================================================================

// Calculation utilities
export {
  getDependentAmountFromV4Position,
  getDependentAmount,
  isPositionInRange,
  getAddableTokens,
  isInvalidPrice,
  isInvalidRange,
  isOutOfRange,
  getTickSpaceLimits,
  getTicksAtLimit,
  tryParseV4Tick,
  tryParsePrice,
  tryParseCurrencyAmount,
  getFieldsDisabled,
  createMockV4Pool,
  getV4PriceRangeInfo,
  getBaseAndQuoteCurrencies,
  type PriceRangeInput,
  getPriceDifference,
  getPriceDifferenceMessage,
  getPriceDifferenceColor,
  formatPriceDifference,
  shouldShowPriceWarning,
  comparePrices,
  isPriceWithinRange,
  getPricePositionInRange,
} from './utils/calculations';

// Validation utilities (fee tiers, error handling)
export {
  DYNAMIC_FEE_AMOUNT,
  DEFAULT_TICK_SPACING,
  DYNAMIC_FEE_DATA,
  // Error handling utilities
  extractErrorMessage,
  isUserRejectionError,
  isNetworkError,
  categorizeError,
  type ErrorCategory,
} from './utils/validation';

// Parsing utilities (amount parsing)
export {
  safeParseUnits,
  parseDisplayAmount,
  cleanAmountForAPI,
  formatAmountDisplay,
  isZeroAmount,
  isValidAmount,
  amountsEqual,
} from './utils/parsing';

// =============================================================================
// TRANSACTION - Step management (builders sunsetted in favor of Uniswap LP API)
// =============================================================================

// Step factory functions - COPIED FROM UNISWAP
export {
  parseERC20ApproveCalldata,
  createApprovalTransactionStep,
  createRevocationTransactionStep,
  createPermit2SignatureStep,
  createPermit2TransactionStep,
  createIncreasePositionStep,
  createIncreasePositionAsyncStep,
  createIncreasePositionStepBatched,
  createDecreasePositionStep,
  createCollectFeesStep,
  orderIncreaseLiquiditySteps,
  orderDecreaseLiquiditySteps,
  orderCollectFeesSteps,
  generateStepperSteps,
  createInitialFlowState,
  getNextStep,
  isFlowComplete,
  hasFlowError,
  type IncreaseLiquidityFlow,
  type DecreaseLiquidityFlow,
  type CollectFeesFlow,
  type ValidatedPermit,
} from './transaction/steps';

// =============================================================================
// UNIFIED YIELD - Alternative liquidity provision through Hook + ERC-4626 vault
// =============================================================================

export {
  // Types
  type UnifiedYieldPosition,
  type UnifiedYieldDepositParams,
  type UnifiedYieldDepositTxResult,
  type UnifiedYieldApprovalStatus,
  type UnifiedYieldApprovalParams,
  isUnifiedYieldPosition,
  // Approval hooks
  useUnifiedYieldApprovals,
  type UseUnifiedYieldApprovalsParams,
  type UseUnifiedYieldApprovalsOptions,
  type UseUnifiedYieldApprovalsResult,
  // Transaction building
  buildUnifiedYieldDepositTx,
  validateUnifiedYieldDepositParams,
  // Position fetching
  fetchUnifiedYieldPositions,
  type FetchUnifiedYieldPositionsConfig,
  // Position adapter
  adaptUnifiedYieldToProcessedPosition,
} from './unified-yield';
