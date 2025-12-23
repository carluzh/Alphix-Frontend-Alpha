/**
 * Position Hooks
 *
 * Hooks for position creation and management.
 */

export {
  useDerivedPositionInfo,
  useDerivedPositionInfoFromState,
  getFeeDataFromPool,
  type UseDerivedPositionInfoParams,
} from './useDerivedPositionInfo';

export {
  useDepositInfo,
  checkBalanceInsufficiency,
  getMaxSpendableAmount,
  type UseDepositInfoParams,
  type BalanceCheckResult,
} from './useDepositInfo';

export {
  // Types
  type DependentAmountFallbackParams,
  type UpdatedAmounts,
  // Hooks
  useCreatePositionDependentAmountFallback,
  useIncreasePositionDependentAmountFallback,
  useUpdatedAmountsFromDependentAmount,
  // Utilities
  mergeDepositInfoWithFallback,
  needsDependentAmountCalculation,
  getExactFieldFromAmounts,
} from './useDependentAmountFallback';
