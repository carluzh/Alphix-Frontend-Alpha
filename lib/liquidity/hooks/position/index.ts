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

export {
  useIncreaseLiquidity,
  providePreSignedIncreaseBatchPermit,
  buildIncreaseLiquidityTx,
  parseTokenIdFromPosition,
  type IncreasePositionData,
} from './useIncreaseLiquidity';

export {
  useDecreaseLiquidity,
  buildDecreaseLiquidityTx,
  buildCollectFeesTx,
  type DecreasePositionData,
} from './useDecreaseLiquidity';

export {
  useDerivedIncreaseInfo,
  type UseDerivedIncreaseInfoParams,
  type DerivedIncreaseInfo,
  type UseDerivedIncreaseInfoResult,
} from './useDerivedIncreaseInfo';

export {
  usePositionAPR,
  type UsePositionAPRParams,
  type UsePositionAPRResult,
  type CachedPoolMetrics,
} from './usePositionAPR';

// Step-based liquidity hooks - Uniswap pattern
export {
  useStepBasedIncreaseLiquidity,
  useStepBasedDecreaseLiquidity,
  useStepBasedCollectFees,
  type UseStepBasedIncreaseProps,
  type UseStepBasedDecreaseProps,
  type UseStepBasedCollectProps,
  type IncreasePositionParams,
  type DecreasePositionParams,
  type CollectFeesParams,
} from './useStepBasedLiquidity';
