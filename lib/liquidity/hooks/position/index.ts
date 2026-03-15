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
  useDerivedIncreaseInfo,
  type UseDerivedIncreaseInfoParams,
  type DerivedIncreaseInfo,
  type UseDerivedIncreaseInfoResult,
} from './useDerivedIncreaseInfo';

// Step-based liquidity hooks removed — execution now handled by
// useStepExecutor + useLiquidityExecutors (lib/transactions/flows/)
