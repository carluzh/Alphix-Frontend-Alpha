/**
 * Unified Yield Zap Module
 *
 * Enables single-token deposits into Unified Yield pools (USDS/USDC, ETH/USDC).
 * Automatically swaps to balance the deposit using PSM, pool swap, or Kyberswap.
 *
 * @example
 * ```typescript
 * import { calculateOptimalSwapAmount, selectSwapRoute, generateZapSteps } from '@/lib/liquidity/zap';
 *
 * // 1. Calculate optimal swap amount
 * const swapAmount = calculateOptimalSwapAmount('token0', inputAmount, poolRatio);
 *
 * // 2. Select route (PSM vs Pool)
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
  PSMRouteDetails,
  PoolRouteDetails,
  KyberswapRouteDetails,
  RouteDetails,
  ZapCalculationInput,
  ZapCalculationResult,
  ZapPreviewResult,
  ZapApprovalStatus,
  ZapTransactionStepType,
  ZapSwapApprovalStep,
  ZapPSMSwapStep,
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
  PSM_CONFIG,
  USDS_USDC_POOL_CONFIG,
  PSM_PRICE_IMPACT_THRESHOLD,
  KYBERSWAP_PRICE_IMPACT_THRESHOLD,
  MAX_ACCEPTABLE_PRICE_IMPACT,
  PRICE_IMPACT_WARNING_THRESHOLD,
  SWAP_AMOUNT_HAIRCUT,
  MAX_PREVIEW_AGE_MS,
  MINIMUM_SLIPPAGE_TOLERANCE,
  DEFAULT_ZAP_SLIPPAGE,
  PERMIT2_ADDRESS,
  USDS_USDC_DECIMAL_DIFF,
  USDC_TO_USDS_MULTIPLIER,
  USDS_TO_USDC_DIVISOR,
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
  calculatePSMOutput,
  estimateLeftover,
  calculateLeftoverPercent,
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
  getPSMQuote,
  previewPSMSwap,
  buildPSMSwapCalldata,
  getPSMApprovalInfo,
  calculateMinOutputWithSlippage,
  selectSwapRoute,
  getPoolQuote,
  type PSMQuoteResult,
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
// ABI
// =============================================================================

export { PSM3_ABI, type PSM3Abi } from './abi/psmABI';

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
