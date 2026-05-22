/**
 * Unified Yield Zap Module
 *
 * Enables single-token deposits into Unified Yield pools (USDC/USDT, ETH/USDC).
 * Automatically swaps to balance the deposit using pool swap or Kyberswap.
 *
 * @example
 * ```typescript
 * import { calculateOptimalSwapAmount, selectSwapRoute, generateZapSteps } from '@/lib/liquidity/zap';
 *
 * // 1. Calculate optimal swap amount
 * const swapAmount = calculateOptimalSwapAmount('token0', inputAmount, poolRatio);
 *
 * // 2. Select route (Pool vs Kyberswap)
 * const routeResult = await selectSwapRoute({ inputToken, swapAmount, publicClient });
 *
 * // 3. Generate transaction steps
 * const { steps } = generateZapSteps({ calculation, approvals, hookAddress, ... });
 *
 * // 4. Execute steps via step executor
 * ```
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  ZapToken,
  TokenPosition,
  ZapSwapRoute,
  PoolRouteDetails,
  KyberswapRouteDetails,
  RouteDetails,
  ZapCalculationInput,
  ZapCalculationResult,
  ZapPreviewResult,
  ZapApprovalStatus,
  ZapTransactionStepType,
  ZapSwapApprovalStep,
  ZapPoolSwapStep,
  ZapStep,
  UseZapPreviewParams,
  ZapErrorCode,
} from './types';

export { ZapError } from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

export {
  PEGGED_POOL_PRICE_IMPACT_THRESHOLD,
  KYBERSWAP_PRICE_IMPACT_THRESHOLD,
  MAX_ACCEPTABLE_PRICE_IMPACT,
  PRICE_IMPACT_WARNING_THRESHOLD,
  SWAP_AMOUNT_HAIRCUT,
  MAX_PREVIEW_AGE_MS,
  MINIMUM_SLIPPAGE_TOLERANCE,
  DEFAULT_ZAP_SLIPPAGE,
  PERMIT2_ADDRESS,
  isZapEligiblePool,
  getZapPoolConfig,
  getZapPoolConfigByHook,
  type ZapPoolConfig,
} from './constants';

// =============================================================================
// CALCULATION
// =============================================================================

export {
  calculateOptimalSwapAmount,
  calculatePoolRatio,
  calculatePoolRatioFromToken1,
  calculatePostSwapAmounts,
  estimateLeftover,
  calculatePriceImpact,
  calculatePriceImpactFromMidPrice,
  analyzePriceImpact,
  calculateMinOutput,
  calculateMaxInput,
  formatPriceImpact,
  getPriceImpactColor,
  findOptimalSwapAmount,
  type PriceImpactAnalysis,
  type OptimalSwapResult,
  type FindOptimalSwapParams,
} from './calculation';

// =============================================================================
// ROUTING
// =============================================================================

export {
  selectSwapRoute,
  getPoolQuote,
  type RouteSelectionParams,
  type RouteSelectionResult,
  type PoolQuoteResult,
} from './routing';

// =============================================================================
// EXECUTION
// =============================================================================

export {
  generateZapSteps,
  type GenerateZapStepsParams,
  type GenerateZapStepsResult,
} from './execution';

// =============================================================================
// HOOKS
// =============================================================================

export {
  useZapPreview,
  isPreviewFresh,
  useZapApprovals,
  getNeededApprovalDescriptions,
  type UseZapApprovalsParams,
  type UseZapApprovalsReturn,
} from './hooks';
