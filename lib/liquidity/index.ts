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
export { PositionField, type FeeData, RangeAmountInputPriceMode, type PositionState, type PriceRangeState, type CreatePositionInfo, type PriceRangeInfo, type DepositState, type DepositInfo, type V4PositionInfo, type WarningSeverity, type PriceDifference } from './types/position';
export { TransactionStepType, LiquidityTransactionType, type ValidatedTransactionRequest, type OnChainTransactionFields, type SignTypedDataStepFields, type TokenInfo, type TokenApprovalTransactionStep, type TokenRevocationTransactionStep, type Permit2SignatureStep, type Permit2TransactionStep, type IncreasePositionTransactionStep, type IncreasePositionTransactionStepAsync, type IncreasePositionTransactionStepBatched, type DecreasePositionTransactionStep, type CollectFeesTransactionStep, type IncreaseLiquiditySteps, type DecreaseLiquiditySteps, type CollectFeesSteps, type TransactionStep, type LiquidityAction, type IncreasePositionTxAndGasInfo, type CreatePositionTxAndGasInfo, type DecreasePositionTxAndGasInfo, type CollectFeesTxAndGasInfo, type LiquidityTxAndGasInfo, type ValidatedLiquidityTxContext, isValidLiquidityTxContext, type FlowStatus, type StepState, type TokenApprovalStatus } from './types/transaction';

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

// Step generator and step factories live at `@/lib/liquidity/transaction`;
// nothing here uses them directly so they are not re-exported.

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
