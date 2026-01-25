/**
 * Approval Hooks & Utilities
 *
 * Hooks for token approvals and permit2 handling.
 * Shared utilities for building approval transactions.
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

// Shared approval transaction utilities
export {
  buildApprovalCalldata,
  buildApprovalRequests,
  type BuildApprovalRequestsParams,
} from './buildApprovalTx';

