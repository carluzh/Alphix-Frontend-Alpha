/**
 * Zap Module
 *
 * Single-token deposits into the Unified Yield USDC/USDT pool on Arbitrum.
 * The swap leg always routes through Kyberswap; the deposit leg is reconciled
 * on-chain by the dynamic deposit handler.
 */

// Types
export type {
  ZapToken,
  KyberswapRouteDetails,
  RouteDetails,
  ZapCalculationResult,
  ZapPreviewResult,
  ZapApprovalStatus,
  UseZapPreviewParams,
} from './types';
export { ZapError, ZapErrorCode } from './types';

// Constants
export {
  MAX_PREVIEW_AGE_MS,
  PERMIT2_ADDRESS,
  isZapEligiblePool,
  getZapPoolConfig,
  getZapPoolConfigByHook,
  getZapPoolConfigByTokens,
  type ZapPoolConfig,
} from './constants';

// Preview (single Kyberswap quote + Hook preview)
export { getZapPreview } from './preview';
export type { ZapPreviewInput, ZapPreviewOutput } from './preview';

// Execution
export {
  generateZapSteps,
  type GenerateZapStepsParams,
  type GenerateZapStepsResult,
} from './execution';

// Hooks
export {
  useZapPreview,
  isPreviewFresh,
  useZapApprovals,
  getNeededApprovalDescriptions,
  type UseZapApprovalsParams,
  type UseZapApprovalsReturn,
} from './hooks';
