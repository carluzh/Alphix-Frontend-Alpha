/**
 * FeeStats Components
 *
 * Modular fee stats components mirroring Uniswap's LiquidityPositionFeeStats architecture.
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx
 *
 * IMPORTANT: All calculation logic stays in parent component (PositionCardCompact).
 * These components are purely presentational.
 */

// Types
export type {
  LiquidityPositionMinMaxRangeProps,
  LiquidityPositionFeeStatsProps,
  FeeStatProps,
  APRFeeStatProps,
  MinMaxRangeProps,
} from './types';

// Sub-components
export { FeeStat, FeeStatLoader, LiquidityPositionFeeStatsLoader } from './FeeStat';
export { APRFeeStat } from './APRFeeStat';
export { MinMaxRange } from './MinMaxRange';

// Main component
export { LiquidityPositionFeeStats } from './LiquidityPositionFeeStats';
