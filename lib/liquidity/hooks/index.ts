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
  useDerivedIncreaseInfo,
  type UseDerivedIncreaseInfoParams,
  type DerivedIncreaseInfo,
  type UseDerivedIncreaseInfoResult,
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
} from './approval'

// Range utilities (minimal - most deleted, use SDK directly)
export {
  Bound,
  getIsTickAtLimit,
  isFullRangePosition,
} from './range'

// Transaction hooks
export {
  useAddLiquidityCalculation,
  type CalculatedLiquidityData,
  type CalculationInput,
  type UseAddLiquidityCalculationParams,
  type UseAddLiquidityCalculationResult,
} from './transaction'

// Gas fee estimation hooks
export {
  useGasFeeEstimate,
  useMultiStepGasFeeEstimate,
  type GasFeeEstimateResult,
  type UseGasFeeEstimateParams,
} from './useGasFeeEstimate'

// Transaction preparation hooks
export {
  usePrepareMintQuery,
  type PrepareMintQueryParams,
  type PrepareMintQueryResult,
} from './usePrepareMintQuery'
