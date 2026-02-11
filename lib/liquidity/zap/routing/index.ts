/**
 * Zap Routing Module
 *
 * Route selection between PSM3 and pool swap.
 */

export {
  getPSMQuote,
  previewPSMSwap,
  buildPSMSwapCalldata,
  getPSMApprovalInfo,
  calculateMinOutputWithSlippage,
  type PSMQuoteResult,
} from './psmQuoter';

export {
  selectSwapRoute,
  getPoolQuote,
  compareRoutes,
  type RouteSelectionParams,
  type RouteSelectionResult,
  type PoolQuoteResult,
} from './selectSwapRoute';
