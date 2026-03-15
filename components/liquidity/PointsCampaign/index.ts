/**
 * Points Campaign Components
 *
 * Mirrors Uniswap's LP Incentives module from:
 * - interface/apps/web/src/components/LpIncentives/
 * - interface/apps/web/src/components/Liquidity/LPIncentives/
 *
 * IMPORTANT: Backend logic is IDENTICAL to Uniswap's implementation.
 *
 * Alphix Points Campaign displays points earned on eligible liquidity positions.
 * Uses Alphix branding instead of UNI token.
 */

// Constants
export {
  POINTS_CAMPAIGN_ICON,
  POINTS_CAMPAIGN_NAME,
  POINTS_UNIT,
} from './constants';

// Formatters (backend logic identical to Uniswap)
export {
  formatPercent,
  formatAprForTooltip,
  PLACEHOLDER_TEXT,
  type PercentNumberDecimals,
} from './formatters';

// Types - PositionPointsData canonical definition is in @/types
export type { PositionPointsData } from '@/types';

// Tooltip Components
export { PointsTooltip, TooltipSize } from './PointsTooltip';

// Display Components
export { PointsFeeStat } from './PointsFeeStat';
