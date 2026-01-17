/**
 * Approval Hooks
 *
 * Hooks for token approvals and permit2 handling.
 */

export {
  useLiquidityApprovals,
  useCheckMintApprovals,
  useCheckIncreaseApprovals,
  type UseApprovalsParams,
  type UseApprovalsOptions,
  type UseApprovalsResult,
  type CheckMintApprovalsParams,
  type CheckIncreaseApprovalsParams,
  type LegacyApprovalResponse,
} from './useApprovals';

// Mode-aware approval hook (supports both V4 and Unified Yield)
export {
  useModeAwareApprovals,
  useCheckMintApprovalsWithMode,
  type UseModeAwareApprovalsParams,
  type UseModeAwareApprovalsOptions,
  type UseModeAwareApprovalsResult,
  type ModeAwareApprovalResult,
} from './useModeAwareApprovals';

