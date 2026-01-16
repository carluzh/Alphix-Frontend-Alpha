/**
 * Liquidity UI Hooks
 *
 * UI-specific hooks that remain in components/liquidity/hooks.
 * Core calculation hooks have been moved to @/lib/liquidity/hooks.
 */

// UI-specific hooks that remain here
export {
  useBalanceWiggle,
  useApprovalWiggle,
  type UseBalanceWiggleResult,
} from './useBalanceWiggle';

export {
  useRangeDisplay,
  type UseRangeDisplayParams,
  type RangeDisplayResult,
} from './useRangeDisplay';


// Re-export from lib for backwards compatibility
export {
  useAddLiquidityCalculation,
  type CalculatedLiquidityData,
  type CalculationInput,
  type UseAddLiquidityCalculationParams,
  type UseAddLiquidityCalculationResult,
} from '@/lib/liquidity/hooks';

export {
  usePositionAPR,
  type UsePositionAPRParams,
  type UsePositionAPRResult,
  type CachedPoolMetrics,
} from '@/lib/liquidity/hooks';

export {
  useDerivedIncreaseInfo,
  type UseDerivedIncreaseInfoParams,
  type UseDerivedIncreaseInfoResult,
  type DerivedIncreaseInfo,
} from '@/lib/liquidity/hooks';
