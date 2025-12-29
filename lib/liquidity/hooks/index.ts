/**
 * Liquidity Hooks
 *
 * Custom React hooks for liquidity operations.
 */

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
  useIncreaseLiquidity,
  providePreSignedIncreaseBatchPermit,
  buildIncreaseLiquidityTx,
  parseTokenIdFromPosition,
  type IncreasePositionData,
  useDecreaseLiquidity,
  buildDecreaseLiquidityTx,
  buildCollectFeesTx,
  type DecreasePositionData,
  useDerivedIncreaseInfo,
  type UseDerivedIncreaseInfoParams,
  type DerivedIncreaseInfo,
  type UseDerivedIncreaseInfoResult,
  usePositionAPR,
  type UsePositionAPRParams,
  type UsePositionAPRResult,
  type CachedPoolMetrics,
  // Step-based hooks - Uniswap pattern
  useStepBasedIncreaseLiquidity,
  useStepBasedDecreaseLiquidity,
  useStepBasedCollectFees,
  type UseStepBasedIncreaseProps,
  type UseStepBasedDecreaseProps,
  type UseStepBasedCollectProps,
  type IncreasePositionParams,
  type DecreasePositionParams,
  type CollectFeesParams,
} from './position'

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
  useCheckZapApprovals,
  type CheckZapApprovalsParams,
  type CheckZapApprovalsResponse,
} from './approval'

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
} from './range'

// Transaction hooks
export {
  useAddLiquidityTransaction,
  type UseAddLiquidityTransactionProps,
  useAddLiquidityTransactionV2,
  type UseAddLiquidityTransactionV2Props,
  useAddLiquidityCalculation,
  type CalculatedLiquidityData,
  type CalculationInput,
  type UseAddLiquidityCalculationParams,
  type UseAddLiquidityCalculationResult,
} from './transaction'
