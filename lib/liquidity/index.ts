/**
 * Unified Liquidity Module
 *
 * Organized following Uniswap's structure:
 * - types/        Type definitions
 * - hooks/        Custom React hooks
 * - utils/        Pure utility functions
 * - transaction/  Transaction builders and steps
 * - state/        State management
 */

// =============================================================================
// TYPES - Centralized type definitions
// =============================================================================

export * from './types';

// =============================================================================
// HOOKS - Custom React hooks for liquidity operations
// =============================================================================

// Position hooks
export {
  useDerivedPositionInfo,
  useDerivedPositionInfoFromState,
  getFeeDataFromPool,
  type UseDerivedPositionInfoParams,
  useDepositInfo,
  checkBalanceInsufficiency,
  getMaxSpendableAmount,
  type UseDepositInfoParams,
  type BalanceCheckResult,
  type DependentAmountFallbackParams,
  type UpdatedAmounts,
  useCreatePositionDependentAmountFallback,
  useIncreasePositionDependentAmountFallback,
  useUpdatedAmountsFromDependentAmount,
  mergeDepositInfoWithFallback,
  needsDependentAmountCalculation,
  getExactFieldFromAmounts,
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
} from './hooks/approval';

// Range hooks
export {
  type PriceOrdering,
  Bound,
  type RangeDisplayResult,
  useIsTickAtLimit,
  useGetRangeDisplay,
  getIsTickAtLimit,
  getRangeDisplay,
  formatRangeString,
  isFullRangePosition,
} from './hooks/range';

// Zap approvals (re-export from component - has API integration)
export {
  useCheckZapApprovals,
  type CheckZapApprovalsParams,
  type CheckZapApprovalsResponse,
} from '@liquidity/useCheckZapApprovals';

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
  getV4TickToPrice,
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
  // Price conversion utilities
  convertPriceToValidTick,
  convertTickToPrice,
  getNearestUsableTick,
  calculateTicksFromPercentage,
  type PriceToTickParams,
  type TickToPriceParams,
} from './utils/calculations';

// Validation utilities (fee tiers, error handling)
export {
  DYNAMIC_FEE_AMOUNT,
  DEFAULT_TICK_SPACING,
  DYNAMIC_FEE_DATA,
  MAX_FEE_TIER_DECIMALS,
  BIPS_BASE,
  type FeeTierData,
  type DynamicFeeVisualization,
  type PoolTypeInfo,
  validateFeeTier,
  calculateTickSpacingFromFeeAmount,
  formatFeePercent,
  formatFeeForDisplay,
  getFeeTierKey,
  isDynamicFeeTier,
  getFeeTierTitle,
  getPoolTypeInfo,
  getDynamicFeeVisualization,
  formatDynamicFee,
  getDynamicFeeColor,
  compareFeeTiers,
  sortFeeTiersByTvl,
  sortFeeTiersByFee,
  getAlphixFeeData,
  isAlphixDynamicFee,
  createFeeDataFromPoolConfig,
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
// TRANSACTION - Builders and step management
// =============================================================================

// Transaction builders
export {
  buildIncreaseLiquidityTx,
  prepareIncreasePermit,
  parseTokenIdFromPosition,
  type IncreasePositionData,
  type IncreasePositionParams,
  type BuildIncreaseOptions,
  type BuildIncreaseTxResult,
  type BuildIncreaseTxContext,
  type PrepareIncreasePermitParams,
  buildDecreaseLiquidityTx,
  buildCollectFeesTx,
  type DecreasePositionData,
  type DecreasePositionParams,
  type BuildDecreaseOptions,
  type BuildDecreaseTxResult,
  type BuildDecreaseTxContext,
} from './transaction/builders';

// Step factory functions
export {
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
  type CreateApprovalStepParams,
  type CreatePermit2SignatureStepParams,
  type CreatePermit2TransactionStepParams,
} from './transaction/steps';

// =============================================================================
// STATE - State management for position creation
// =============================================================================

export {
  type MintState,
  type MintAction,
  MintActionType,
  initialMintState,
  mintActions,
  mintReducer,
  MintStateProvider,
  useMintStore,
  useMintState,
  useMintActionHandlers,
  useMintDispatch,
} from './state';
