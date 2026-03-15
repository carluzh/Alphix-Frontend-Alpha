import type { FeeData } from '../../types';

/**
 * Dynamic fee flag value (0x800000)
 * When a pool has this fee value, it indicates dynamic fees managed by hooks.
 */
export const DYNAMIC_FEE_AMOUNT = 8388608;

/**
 * Default tick spacing for dynamic fee pools
 */
export const DEFAULT_TICK_SPACING = 60;

/**
 * Default dynamic fee data
 */
export const DYNAMIC_FEE_DATA: FeeData = {
  isDynamic: true,
  feeAmount: DYNAMIC_FEE_AMOUNT,
  tickSpacing: DEFAULT_TICK_SPACING,
};
