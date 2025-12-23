/**
 * Range Hooks
 *
 * Hooks for price range selection and display.
 */

export {
  // Types
  type PriceOrdering,
  Bound,
  type RangeDisplayResult,
  // Hooks
  useIsTickAtLimit,
  useGetRangeDisplay,
  // Utilities
  getIsTickAtLimit,
  getRangeDisplay,
  formatRangeString,
  isFullRangePosition,
} from './useGetRangeDisplay';
