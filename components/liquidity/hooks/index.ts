/**
 * Liquidity Hooks
 *
 * Custom React hooks for liquidity operations.
 */

export {
  useAddLiquidityCalculation,
  type CalculatedLiquidityData,
  type CalculationInput,
  type UseAddLiquidityCalculationParams,
  type UseAddLiquidityCalculationResult,
} from './useAddLiquidityCalculation';

// Note: useOutOfRangeCheck removed - use isOutOfRange/isPositionInRange from @/lib/liquidity instead

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

export {
  usePositionAPY,
  type UsePositionAPYParams,
  type UsePositionAPYResult,
  type CachedPoolMetrics,
} from './usePositionAPY';

export {
  useZapQuote,
  type UseZapQuoteParams,
  type UseZapQuoteResult,
  type ZapQuoteData,
  type ZapTransactionData,
  type FetchZapQuoteParams,
} from './useZapQuote';
