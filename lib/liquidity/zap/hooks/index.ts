/**
 * Zap Hooks Module
 *
 * React hooks for the Unified Yield zap deposit feature.
 */

// =============================================================================
// PREVIEW HOOK
// =============================================================================

export { useZapPreview, isPreviewFresh } from './useZapPreview';

// =============================================================================
// APPROVALS HOOK
// =============================================================================

export {
  useZapApprovals,
  getNeededApprovalDescriptions,
  type UseZapApprovalsParams,
  type UseZapApprovalsReturn,
} from './useZapApprovals';

// =============================================================================
// MAIN DEPOSIT HOOK
// =============================================================================

export {
  useZapDeposit,
  estimateZapGas,
  formatZapPreviewForDisplay,
} from './useZapDeposit';
